/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getChannelConfig, settings } from "../settings";
import { splitTranslationText } from "../utils/batching";
import { shouldTranslate } from "../utils/message";
import { describeGeminiQuotaLock, getGeminiActiveQuotaLock, showGeminiQuotaToast } from "./breaker";
import { AiChannelWorker, aiWorkers, reScheduleAllWorkers,resetAllWorkers } from "./worker";

export { reScheduleAllWorkers };

export function resetTranslationQueues() {
    resetAllWorkers();
}

/**
 * Unified translation entry point with concurrency control.
 */
export async function translate(
    channelId: string,
    messageId: string,
    text: string,
    _sourceLang: string,
    targetLang: string,
    engine: string,
    apiKeys: { gemini: string, deepseek: string },
    customPrompt?: string
): Promise<string> {
    const parts = splitTranslationText(text);
    const requests = parts.map(part => part.text.trim() ? translateChunk(channelId, messageId, part.text, _sourceLang,
        targetLang, engine, apiKeys, customPrompt) : Promise.resolve(part.text));
    if (!messageId) aiWorkers.get(channelId)?.flushNow();
    const results = await Promise.all(requests);
    if (results.some((result, index) => !result && parts[index].text.trim())) return "";
    return results.map((result, index) => result + parts[index].separator).join("");
}

async function translateChunk(
    channelId: string,
    messageId: string,
    text: string,
    _sourceLang: string,
    targetLang: string,
    engine: string,
    apiKeys: { gemini: string, deepseek: string },
    customPrompt?: string
): Promise<string> {
    if (engine?.startsWith("gemini") || engine?.startsWith("deepseek")) {
        const isDeepSeek = engine.startsWith("deepseek");
        const engineKey = isDeepSeek ? apiKeys.deepseek : apiKeys.gemini;

        if (!isDeepSeek) {
            const activeLock = getGeminiActiveQuotaLock(engineKey);
            if (activeLock) {
                showGeminiQuotaToast(activeLock.kind, activeLock.until);
                throw new Error(describeGeminiQuotaLock(activeLock.kind, activeLock.until));
            }
        }

        const result = await new Promise<string>((resolve, reject) => {
            const { config } = getChannelConfig(channelId);
            const dmPrompt = customPrompt ?? config?.aiCustomPrompt ?? "";

            if (!aiWorkers.has(channelId)) {
                aiWorkers.set(channelId, new AiChannelWorker(channelId));
            }

            const worker = aiWorkers.get(channelId)!;
            const taskId = crypto.randomUUID();
            worker.enqueue({
                id: taskId, messageId, channelId, text, resolve, reject, targetLang, apiKey: engineKey, engine, dmPrompt,
                model: isDeepSeek ? settings.store.deepseekModel : settings.store.geminiModel,
                endpoint: isDeepSeek ? settings.store.deepseekBaseUrl : undefined
            });
        });

        if (result !== "") {
            return result;
        }

        if (!isDeepSeek) {
            const retryLock = getGeminiActiveQuotaLock(engineKey);
            if (retryLock) showGeminiQuotaToast(retryLock.kind, retryLock.until);
        }

        return "";
    }

    // Default fallback (should not be reached unless engine is unknown)
    return Promise.resolve("");
}



// --- Tokenizer Helpers ---
const PRESERVE_BASE = /<@[!&]?\d+>|<#\d+>|<[^>]+>|https?:\/\/[^\s]+|```[\s\S]*?```|`[^`]+`/gmu;

export function getAiBatchState(channelId: string, messageId: string) {
    const worker = aiWorkers.get(channelId);
    if (!worker) return null;

    const task = Array.from(worker.registry.values()).find(t => t.messageId === messageId);
    if (!task) return null;

    if (task.status === "PROCESSING") {
        return { isProcessing: true, isFired: true };
    }

    if (worker.state === "PROCESSING") {
        return {
            deadline: Date.now() + 5000,
            leaderIds: worker.leaderIds,
            isProcessing: false,
            isFired: false,
            isPaused: true
        };
    }

    const ecoThreshold = settings.store.APIEcoModeThreshold || 1;
    const maxWaitMs = (settings.store.APIMaxBatchWait ?? 0) * 1000;
    return {
        deadline: worker.deadline,
        leaderIds: worker.leaderIds,
        isProcessing: false,
        isFired: false,
        ecoProgress: (worker.thresholdMetTime || worker.getQueuedCount() >= ecoThreshold) ? 1 : worker.getQueuedCount() / ecoThreshold,
        startTime: worker.firstMessageTime,
        maxWaitMs
    };
}

function tokenizeText(text: string, hideEmojis: boolean, hideMentions: boolean): { textToTranslate: string, tokens: string[] } {
    const tokens: string[] = [];
    let textToTranslate = text;

    if (hideEmojis) {
        // Remove emojis completely
        textToTranslate = textToTranslate
            .replace(/<a?:\w+:\d+>/g, "")
            .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
    }

    if (hideMentions) {
        // Remove mentions completely
        textToTranslate = textToTranslate.replace(/<@[!&]?\d+>/g, "");
    }

    // Tokenize remaining special elements (URLs, code blocks, etc.)
    textToTranslate = textToTranslate.replace(PRESERVE_BASE, match => {
        const id = tokens.length;
        tokens.push(match);
        return `[token${id}]`;
    });

    return { textToTranslate, tokens };
}

function restoreTokens(text: string, tokens: string[]): string {
    return text.replace(/\[\s*token(\d+)\s*\]/gi, (match, idStr) => {
        const id = parseInt(idStr, 10);
        return tokens[id] !== undefined ? tokens[id] : match;
    });
}

export async function safeTranslate(
    content: string,
    sourceLang: string,
    targetLang: string,
    engine: string,
    apiKeys: { gemini: string, deepseek: string },
    channelId?: string,
    messageId?: string,
    customPrompt?: string
): Promise<string | null> {
    if (!shouldTranslate(content, targetLang)) return null;

    // 1. Tokenize (Extract mentions, code blocks, emojis)
    const { textToTranslate, tokens } = tokenizeText(content.trim(), settings.store.hideEmojis, settings.store.hideMentions);

    const result = await translate(
        channelId || "",
        messageId || "",
        textToTranslate,
        sourceLang,
        targetLang,
        engine,
        apiKeys,
        customPrompt
    );

    if (!result || result === textToTranslate) return null;

    // Restore tokens
    return restoreTokens(result, tokens);
}
