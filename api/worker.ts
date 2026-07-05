/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BATCH_ACCUMULATION_TIME_DEEPL, BATCH_ACCUMULATION_TIME_GEMINI, DEEPL_BATCH_SIZE, GEMINI_BATCH_SIZE } from "../constants";
import { settings } from "../settings";
import { Logger } from "../utils/logger";
import { globalProgressStore } from "../utils/progressStore";
import { APIBreaker, setGeminiQuotaLock, showApiToast, showGeminiQuotaToast } from "./breaker";
import { translateWithDeepL } from "./deepl";
import { translateBatchWithDeepSeek } from "./deepseek";
import { translateBatchWithGemini } from "./gemini";

function showEngineToast(engine: string, reason: string) {
    showApiToast(engine, reason);
}

export interface TranslationTask {
    id: string;
    messageId: string;
    channelId: string;
    text: string;
    resolve: (res: string) => void;
    targetLang: string;
    apiKey: string;
    engine: string;
    dmPrompt: string;
    status?: "QUEUED" | "PROCESSING";
    isManual?: boolean;
    dictMatches?: Record<string, string>;
}

export class Mutex {
    private mutex = Promise.resolve();

    acquire(): Promise<() => void> {
        let release!: () => void;
        const next = new Promise<void>(resolve => {
            release = resolve;
        });
        const current = this.mutex;
        this.mutex = this.mutex.then(() => next);
        return current.then(() => release);
    }
}

export const globalGeminiMutex = new Mutex();

export type WorkerState = "IDLE" | "ACCUMULATING" | "PROCESSING";

export class GeminiChannelWorker {
    public channelId: string;
    public registry = new Map<string, TranslationTask>();
    public state: WorkerState = "IDLE";
    public deadline: number = 0;
    public leaderIds: string[] = [];
    private timer: NodeJS.Timeout | null = null;
    private abortController: AbortController | null = null;

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
        task.status = "QUEUED";
        this.registry.set(task.messageId, task);
        this.schedule();
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
            geminiWorkers.delete(this.channelId);
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

        const hasManual = Array.from(this.registry.values()).some(t => t.isManual && (t.status === "QUEUED" || !t.status));

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

        if (hasManual) {
            deadline = now + 150; // 150ms debounce for manual requests
            ecoProgress = 1;
        } else if (queuedCount >= GEMINI_BATCH_SIZE) {
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
        if (this.registry.size === 0) return;

        const currentTasks: TranslationTask[] = [];
        for (const t of this.registry.values()) {
            if (t.status === "QUEUED" || !t.status) {
                t.status = "PROCESSING";
                currentTasks.push(t);
            }
        }

        if (currentTasks.length === 0) return;

        this.state = "PROCESSING";
        this.firstMessageTime = 0;
        this.thresholdMetTime = 0;

        globalProgressStore.reset();

        window.dispatchEvent(new CustomEvent(`bat-gemini-fired-${this.channelId}`, {
            detail: { taskIds: currentTasks.map(t => t.messageId) }
        }));

        const grouped = new Map<string, TranslationTask[]>();
        for (const t of currentTasks) {
            const key = `${t.targetLang}|||${t.apiKey}|||${t.engine}|||${t.dmPrompt}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(t);
        }

        for (const [key, groupTasks] of grouped.entries()) {
            const [targetLang, apiKey, engine, dmPrompt] = key.split("|||");
            const reversedTasks = groupTasks.slice().reverse();

            const chunks: TranslationTask[][] = [];
            let currentChunk: TranslationTask[] = [];

            for (const task of reversedTasks) {
                if (currentChunk.length >= GEMINI_BATCH_SIZE) {
                    chunks.push(currentChunk);
                    currentChunk = [];
                }
                currentChunk.push(task);
            }
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
            }

            for (const chunk of chunks) {

                const release = await globalGeminiMutex.acquire();

                try {
                    this.abortController = new AbortController();
                    const timeoutId = setTimeout(() => this.abortController?.abort(), 300000);

                    try {
                        const messagesToTranslate = chunk.map(t => ({ id: t.messageId, text: t.text }));

                        let combinedDmPrompt = dmPrompt;
                        const chunkGlossary: Record<string, string> = {};
                        for (const t of chunk) {
                            if (t.dictMatches) {
                                Object.assign(chunkGlossary, t.dictMatches);
                            }
                        }
                        const glossaryKeys = Object.keys(chunkGlossary);
                        if (glossaryKeys.length > 0) {
                            let glossaryStr = "\n\n# User Dictionary / Glossary\nCRITICAL: You MUST strictly use the exact translations provided below for the following specific terms. Do NOT translate them differently:\n";
                            for (const k of glossaryKeys) {
                                glossaryStr += `- "${k}": "${chunkGlossary[k]}"\n`;
                            }
                            combinedDmPrompt += glossaryStr;
                        }

                        let fetchPromise;
                        if (engine.startsWith("deepseek")) {
                            fetchPromise = translateBatchWithDeepSeek(
                                this.channelId,
                                messagesToTranslate,
                                targetLang,
                                apiKey,
                                combinedDmPrompt,
                                engine
                            );
                        } else {
                            fetchPromise = translateBatchWithGemini(
                                this.channelId,
                                messagesToTranslate,
                                targetLang,
                                apiKey,
                                combinedDmPrompt,
                                engine,
                                this.abortController.signal
                            );
                        }

                        const timeoutPromise = new Promise<any>((_, reject) => {
                            this.abortController?.signal.addEventListener("abort", () => reject(new Error("Timeout: Gemini API logical abort (5m limit).")));
                        });

                        const results = await Promise.race([fetchPromise, timeoutPromise]);
                        clearTimeout(timeoutId);

                        const resultMap = new Map(results.map((r: any) => [r.id, r.text]));
                        chunk.forEach(t => { 
                            t.resolve(resultMap.get(t.messageId) || ""); 
                            if (this.registry.get(t.messageId)?.id === t.id) {
                                this.registry.delete(t.messageId); 
                            }
                        });
                    } catch (e: unknown) {
                        clearTimeout(timeoutId);

                        const errorMsg = e instanceof Error ? e.message : String(e);
                        const isTimeout = errorMsg.toLowerCase().includes("timeout");
                        const isNetwork = errorMsg.toLowerCase().includes("network request failed") || errorMsg.toLowerCase().includes("fetch failed");

                        Logger.error("Translate", "Gemini Batch translation error", e);

                        let status: number | null = null;
                        let errorCode: string | null = null;
                        if (typeof e === "object" && e !== null) {
                            if ("status" in e) status = (e as any).status;
                            if ("code" in e) errorCode = (e as any).code;
                        }

                        const quotaKind = typeof e === "object" && e !== null && "quotaKind" in e
                            ? (e as any).quotaKind as "rpm" | "tpm" | "rpd" | undefined
                            : undefined;

                        if (quotaKind) {
                            const until = setGeminiQuotaLock(apiKey, quotaKind);
                            showGeminiQuotaToast(quotaKind, until);
                            this.reset();
                            return;
                        }

                        const engineType = engine.startsWith("deepseek") ? "deepseek" : "gemini";
                        const handledByBreaker = APIBreaker.reportError(engineType, apiKey, status, errorCode, errorMsg);

                        if (handledByBreaker) {
                            this.reset();
                            return;
                        } else if (isTimeout || isNetwork) {
                            showEngineToast(engineType, isTimeout ? "Timeout" : "Network error");
                        } else {
                            const isJsonTruncated = errorMsg.toLowerCase().includes("unterminated string in json") || errorMsg.toLowerCase().includes("unexpected end of json");
                            if (!isJsonTruncated) {
                                showEngineToast(engineType, errorMsg.length > 80 ? errorMsg.substring(0, 80) + "..." : errorMsg || "Request failed");
                            }
                        }

                        chunk.forEach(t => { 
                            t.resolve(""); 
                            if (this.registry.get(t.messageId)?.id === t.id) {
                                this.registry.delete(t.messageId); 
                            }
                        });
                    } finally {
                        this.abortController = null;
                    }
                } finally {
                    release();
                }
            }
        }

        const remainingQueued = this.getQueuedCount();
        if (remainingQueued > 0) {
            this.state = "ACCUMULATING";
            this.firstMessageTime = Date.now();
            this.thresholdMetTime = 0;
            this.schedule();
        } else {
            this.state = "IDLE";
            this.firstMessageTime = 0;
            this.thresholdMetTime = 0;
            if (this.registry.size === 0) {
                geminiWorkers.delete(this.channelId);
            }
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

    private clearPendingTasks() {
        this.registry.forEach(t => t.resolve(""));
        this.registry.clear();
    }

    public reset() {
        if (this.timer) clearTimeout(this.timer);
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.clearPendingTasks();
        this.state = "IDLE";
    }
}

export const geminiWorkers = new Map<string, GeminiChannelWorker>();

export class DeeplChannelWorker {
    public key: string;
    public registry = new Map<string, TranslationTask>();
    public state: WorkerState = "IDLE";
    private timer: NodeJS.Timeout | null = null;
    private abortController: AbortController | null = null;

    constructor(key: string) {
        this.key = key;
    }

    public getQueuedCount() {
        let count = 0;
        for (const t of this.registry.values()) {
            if (t.status === "QUEUED" || !t.status) count++;
        }
        return count;
    }

    public enqueue(task: TranslationTask) {
        task.status = "QUEUED";
        this.registry.set(task.id, task);
        this.schedule();
    }

    private schedule() {
        if (this.timer) clearTimeout(this.timer);

        if (this.registry.size === 0) {
            this.state = "IDLE";
            deeplWorkers.delete(this.key);
            return;
        }

        this.state = "ACCUMULATING";
        this.timer = setTimeout(() => this.process(), BATCH_ACCUMULATION_TIME_DEEPL);
    }

    public reSchedule() {
        if (this.state !== "PROCESSING" && this.getQueuedCount() > 0) {
            this.schedule();
        }
    }

    private clearPendingTasks() {
        this.registry.forEach(t => t.resolve(""));
        this.registry.clear();
    }

    private async process() {
        if (this.registry.size === 0) return;

        const currentTasks: TranslationTask[] = [];
        for (const t of this.registry.values()) {
            if (t.status === "QUEUED" || !t.status) {
                t.status = "PROCESSING";
                currentTasks.push(t);
            }
        }

        if (currentTasks.length === 0) return;

        this.state = "PROCESSING";

        const [, sourceLang, targetLang, apiKey] = this.key.split("|||");
        const reversedTasks = currentTasks.slice().reverse();

        for (let i = 0; i < reversedTasks.length; i += DEEPL_BATCH_SIZE) {
            const chunk = reversedTasks.slice(i, i + DEEPL_BATCH_SIZE);

            this.abortController = new AbortController();
            const timeoutId = setTimeout(() => this.abortController?.abort(), 30000);

            try {
                const texts = chunk.map(t => t.text);
                const fetchPromise = translateWithDeepL(texts, sourceLang, targetLang, apiKey);

                const timeoutPromise = new Promise<any>((_, reject) => {
                    this.abortController?.signal.addEventListener("abort", () => reject(new Error("Timeout: DeepL API logical abort.")));
                });

                const results = await Promise.race([fetchPromise, timeoutPromise]);
                clearTimeout(timeoutId);

                chunk.forEach((t, idx) => { 
                    t.resolve(results[idx] || ""); 
                    if (this.registry.get(t.messageId)?.id === t.id) {
                        this.registry.delete(t.messageId); 
                    }
                });
            } catch (e: unknown) {
                clearTimeout(timeoutId);
                Logger.error("Translate", "DeepL Batch translation error", e);

                const errorMsg = e instanceof Error ? e.message : String(e);
                let status: number | null = null;
                let errorCode: string | null = null;
                if (typeof e === "object" && e !== null) {
                    if ("status" in e) status = (e as any).status;
                    if ("code" in e) errorCode = (e as any).code;
                }

                const handledByBreaker = APIBreaker.reportError("deepl", apiKey, status, errorCode, errorMsg);

                if (!handledByBreaker) {
                    showEngineToast("deepl", errorMsg.length > 80 ? errorMsg.substring(0, 80) + "..." : errorMsg || "Request failed");
                } else {
                    this.reset();
                    return;
                }

                chunk.forEach(t => { 
                    t.resolve(""); 
                    if (this.registry.get(t.messageId)?.id === t.id) {
                        this.registry.delete(t.messageId); 
                    }
                });
            } finally {
                this.abortController = null;
            }
        }

        const remainingQueued = this.getQueuedCount();
        if (remainingQueued > 0) {
            this.state = "ACCUMULATING";
            this.schedule();
        } else {
            this.state = "IDLE";
            if (this.registry.size === 0) {
                deeplWorkers.delete(this.key);
            }
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

    public reset() {
        if (this.timer) clearTimeout(this.timer);
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.clearPendingTasks();
        this.state = "IDLE";
    }
}

export const deeplWorkers = new Map<string, DeeplChannelWorker>();

export function resetAllWorkers() {
    geminiWorkers.forEach(w => w.reset());
    geminiWorkers.clear();
    deeplWorkers.forEach(w => w.reset());
    deeplWorkers.clear();
}

export function reScheduleAllWorkers() {
    geminiWorkers.forEach(w => w.reSchedule());
    deeplWorkers.forEach(w => w.reSchedule());
}
