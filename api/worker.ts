/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BATCH_ACCUMULATION_TIME_GEMINI, GEMINI_BATCH_SIZE } from "../constants";
import { settings } from "../settings";
import { batchTranslationTasks } from "../utils/batching";
import { Logger } from "../utils/logger";
import { globalProgressStore } from "../utils/progressStore";
import { APIBreaker, setGeminiQuotaLock, showApiToast, showGeminiQuotaToast } from "./breaker";
import { translateBatchWithDeepSeek } from "./deepseek";
import { TRANSLATION_TIMEOUT_MS } from "./errors";
import { translateBatchWithGemini } from "./gemini";
import { AI_REQUEST_CONCURRENCY, aiRequestLimiters } from "./requestLimiter";

function limitTask(task: TranslationTask, expire: () => void, fail: (error: Error) => void) {
    const { resolve, reject } = task;
    let settled = false;
    const timer = setTimeout(() => {
        if (settled) return;
        task.reject!(new Error("Translation timed out (20s)"));
        expire();
        showApiToast(task.engine, "Translation timed out (20s)");
    }, TRANSLATION_TIMEOUT_MS);
    task.resolve = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
        if (!result) fail(new Error("Translation returned no result"));
    };
    task.reject = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reject) reject(error);
        else resolve("");
        fail(error);
    };
}

function showEngineToast(engine: string, reason: string) {
    showApiToast(engine, reason);
}

export interface TranslationTask {
    id: string;
    groupId?: string;
    messageId: string;
    channelId: string;
    text: string;
    resolve: (res: string) => void;
    reject?: (error: Error) => void;
    targetLang: string;
    apiKey: string;
    engine: string;
    dmPrompt: string;
    status?: "QUEUED" | "PROCESSING";
    model?: string;
    endpoint?: string;
}

export type WorkerState = "IDLE" | "ACCUMULATING" | "PROCESSING";

export class AiChannelWorker {
    public channelId: string;
    public registry = new Map<string, TranslationTask>();
    public state: WorkerState = "IDLE";
    public deadline: number = 0;
    public leaderIds: string[] = [];
    private timer: NodeJS.Timeout | null = null;
    private activeBatches = new Map<AbortController, Set<string>>();
    private generation = 0;

    constructor(channelId: string) {
        this.channelId = channelId;
    }

    public getQueuedCount() {
        let count = 0;
        for (const t of this.registry.values()) {
            if (t.status === "QUEUED" || !t.status) count++;
        }
        return count;
    }

    public enqueue(task: TranslationTask) {
        limitTask(task, () => {
            this.removeTask(task.id);
            if (this.registry.size === 0) this.reset();
        }, error => this.cancelSiblings(task, error));
        task.status = "QUEUED";
        this.registry.set(task.id, task);
        this.schedule();
    }

    private removeTask(id: string) {
        this.registry.delete(id);
        for (const [controller, ids] of this.activeBatches) {
            if (ids.delete(id) && ids.size === 0) controller.abort();
        }
    }

    private cancelSiblings(task: TranslationTask, error: Error) {
        if (!task.groupId || this.registry.get(task.id) !== task) return;
        const siblings = Array.from(this.registry.values()).filter(other => other !== task && other.groupId === task.groupId);
        // Remove all siblings first so their rejection cannot recursively cancel the group.
        for (const sibling of siblings) this.removeTask(sibling.id);
        for (const sibling of siblings) sibling.reject!(error);
    }

    public firstMessageTime: number = 0;
    public thresholdMetTime: number = 0;

    private schedule() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.registry.size === 0) {
            this.state = "IDLE";
            this.firstMessageTime = 0;
            aiWorkers.delete(this.channelId);
            return;
        }

        const now = Date.now();
        const queuedCount = this.getQueuedCount();
        if (!this.firstMessageTime) {
            this.firstMessageTime = now;
            this.thresholdMetTime = 0;
        }

        const tasks = Array.from(this.registry.values());
        const currentLeaderId = tasks[tasks.length - 1].messageId;

        // Find the chronologically newest message (largest Snowflake ID)
        let newestId = tasks[0].messageId;
        let maxBig = BigInt(newestId);
        for (let i = 1; i < tasks.length; i++) {
            const big = BigInt(tasks[i].messageId);
            if (big > maxBig) {
                maxBig = big;
                newestId = tasks[i].messageId;
            }
        }

        this.leaderIds = Array.from(new Set([currentLeaderId, newestId]));

        if (this.state === "PROCESSING") {
            window.dispatchEvent(new CustomEvent(`bat-gemini-paused-${this.channelId}`, {
                detail: { leaderIds: this.leaderIds }
            }));
            return;
        }

        this.state = "ACCUMULATING";


        const ecoThreshold = settings.store.APIEcoModeThreshold ?? 1;
        const maxWaitMs = (settings.store.APIMaxBatchWait ?? 0) * 1000;

        const isTimeMet = maxWaitMs > 0 && now >= this.firstMessageTime + maxWaitMs;
        const isCountMet = queuedCount >= ecoThreshold;

        if ((isCountMet || isTimeMet) && !this.thresholdMetTime) {
            this.thresholdMetTime = now;
        }

        let deadline: number;
        let ecoProgress: number | undefined;
        let nextAction: "process" | "schedule" = "process";

        if (queuedCount >= GEMINI_BATCH_SIZE) {
            deadline = now + 150; // 150ms debounce for immediate processing
            ecoProgress = 1;
        } else if (ecoThreshold > 1 && queuedCount < ecoThreshold && !this.thresholdMetTime) {
            // 임계값 미달 & 시간 미달 → 대기 중
            if (maxWaitMs > 0) {
                deadline = this.firstMessageTime + maxWaitMs;
                nextAction = "schedule"; // 시간 도달 시 다시 schedule을 호출해 1초 카운트다운으로 넘어가게 함
            } else {
                deadline = Infinity;
            }
            ecoProgress = queuedCount / ecoThreshold;
        } else {
            // 임계값 달성 후 (개수 또는 시간) 무조건 1초 대기 (카운트다운 애니메이션 트리거)
            const baseTime = this.thresholdMetTime || now;
            deadline = baseTime + BATCH_ACCUMULATION_TIME_GEMINI;
            ecoProgress = 1;
        }

        // Reserve half the deadline for the API even in indefinite economy mode.
        const latestDispatch = this.firstMessageTime + TRANSLATION_TIMEOUT_MS / 2;
        if (deadline >= latestDispatch) {
            deadline = latestDispatch;
            nextAction = "process";
        }
        this.deadline = deadline;

        window.dispatchEvent(new CustomEvent(`bat-gemini-debounced-${this.channelId}`, {
            detail: { deadline, leaderIds: this.leaderIds, ecoProgress, startTime: this.firstMessageTime, maxWaitMs }
        }));

        if (deadline !== Infinity) {
            const waitTime = Math.max(0, deadline - now);
            if (waitTime === 0) {
                if (nextAction === "process") this.process();
                else this.schedule();
            } else {
                this.timer = setTimeout(() => {
                    if (nextAction === "process") this.process();
                    else this.schedule();
                }, waitTime);
            }
        }
    }

    private async process() {
        if (this.registry.size === 0 || this.state === "PROCESSING") return;
        const { generation } = this;
        const currentTasks = Array.from(this.registry.values()).filter(task => task.status === "QUEUED");
        if (!currentTasks.length) return;
        currentTasks.forEach(task => { task.status = "PROCESSING"; });
        this.state = "PROCESSING";
        this.firstMessageTime = 0;
        this.thresholdMetTime = 0;
        globalProgressStore.reset(this.channelId);
        window.dispatchEvent(new CustomEvent(`bat-gemini-fired-${this.channelId}`, {
            detail: { taskIds: currentTasks.map(task => task.messageId) }
        }));

        const grouped = new Map<string, TranslationTask[]>();
        for (const task of currentTasks) {
            const key = JSON.stringify([task.targetLang, task.apiKey, task.engine, task.dmPrompt, task.model, task.endpoint]);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(task);
        }
        const order = new Map(currentTasks.map((task, index) => [task, index]));
        const batches = Array.from(grouped.values()).flatMap(tasks => batchTranslationTasks(tasks));
        batches.sort((a, b) => order.get(a[0])! - order.get(b[0])!);
        const queues = [
            batches.filter(batch => !batch[0].engine.startsWith("deepseek")),
            batches.filter(batch => batch[0].engine.startsWith("deepseek"))
        ];
        await Promise.all(queues.flatMap(queue => {
            let next = 0;
            const consume = async () => {
                while (next < queue.length && generation === this.generation) {
                    await this.processBatch(queue[next++], generation);
                }
            };
            return Array.from({ length: Math.min(queue.length, AI_REQUEST_CONCURRENCY) }, consume);
        }));
        if (generation !== this.generation) return;

        if (this.getQueuedCount() > 0) {
            this.state = "ACCUMULATING";
            this.thresholdMetTime = 0;
            this.schedule();
        } else {
            this.state = "IDLE";
            this.firstMessageTime = 0;
            this.thresholdMetTime = 0;
            if (aiWorkers.get(this.channelId) === this) aiWorkers.delete(this.channelId);
        }
    }

    private async processBatch(batch: TranslationTask[], generation: number) {
        const isLive = (task: TranslationTask) => this.registry.get(task.id) === task;
        if (generation !== this.generation || !batch.some(isLive)) return;
        const { targetLang, apiKey, engine, dmPrompt, model, endpoint } = batch[0];
        const controller = new AbortController();
        this.activeBatches.set(controller, new Set(batch.filter(isLive).map(task => task.id)));
        const limiter = aiRequestLimiters[engine.startsWith("deepseek") ? "deepseek" : "gemini"];
        let release: (() => void) | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
            release = await limiter.acquire(controller.signal);
            if (!release || generation !== this.generation || !batch.some(isLive)) return;
            const aborted = new Promise<never>((_, reject) => {
                onAbort = () => reject(new Error("Translation timed out or cancelled"));
                controller.signal.addEventListener("abort", onAbort, { once: true });
            });
            timeoutId = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);
            const messages = batch.filter(isLive).map(task => ({ id: task.id, text: task.text }));
            const request = engine.startsWith("deepseek")
                ? translateBatchWithDeepSeek(this.channelId, messages, targetLang, apiKey, dmPrompt, model!, controller.signal, endpoint)
                : translateBatchWithGemini(this.channelId, messages, targetLang, apiKey, dmPrompt, model!, controller.signal);
            const results = await Promise.race([request, aborted]);
            if (generation !== this.generation) return;
            const resultMap = new Map(results.map(result => [result.id, result.text]));
            for (const task of batch.filter(isLive)) {
                task.resolve(resultMap.get(task.id) || "");
                this.registry.delete(task.id);
            }
        } catch (error) {
            if (generation !== this.generation || !batch.some(isLive)) return;
            const reason = error instanceof Error ? error.message : String(error);
            Logger.error("Translate", "AI batch translation error", error);
            for (const task of batch.filter(isLive)) {
                task.reject!(new Error(reason));
                this.registry.delete(task.id);
            }
            const details = error as { status?: number; code?: string; quotaKind?: "rpm" | "tpm" | "rpd" } | null;
            try {
                if (details?.quotaKind) {
                    const until = setGeminiQuotaLock(apiKey, details.quotaKind);
                    showGeminiQuotaToast(details.quotaKind, until);
                } else {
                    const engineType = engine.startsWith("deepseek") ? "deepseek" : "gemini";
                    const handled = APIBreaker.reportError(engineType, apiKey, details?.status ?? null, details?.code ?? null, reason);
                    if (!handled) showEngineToast(engineType, reason);
                }
            } catch (notificationError) {
                Logger.warn("Translate", "Failed to report translation error", notificationError);
            }
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (onAbort) controller.signal.removeEventListener("abort", onAbort);
            this.activeBatches.delete(controller);
            release?.();
        }
    }

    public flushNow() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.getQueuedCount() > 0 && this.state !== "PROCESSING") {
            this.process();
        }
    }

    public reSchedule() {
        if (this.state !== "PROCESSING" && this.getQueuedCount() > 0) {
            this.schedule();
        }
    }

    private clearPendingTasks(error?: Error) {
        const tasks = Array.from(this.registry.values());
        this.registry.clear();
        tasks.forEach(t => error && t.reject ? t.reject(error) : t.resolve(""));
    }

    public reset(error?: Error) {
        this.generation++;
        if (this.timer) clearTimeout(this.timer);
        for (const controller of this.activeBatches.keys()) controller.abort();
        this.activeBatches.clear();
        this.clearPendingTasks(error);
        this.state = "IDLE";
        if (aiWorkers.get(this.channelId) === this) aiWorkers.delete(this.channelId);
    }
}

export const aiWorkers = new Map<string, AiChannelWorker>();

export function resetAllWorkers() {
    aiWorkers.forEach(w => w.reset());
    aiWorkers.clear();
}

export function reScheduleAllWorkers() {
    aiWorkers.forEach(w => w.reSchedule());
}
