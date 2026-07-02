/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CustomDictionaryStore } from "../dict";
import { getChannelConfig, settings } from "../settings";
import { Logger } from "../utils/logger";
import { shouldTranslate } from "../utils/message";
import { getDictRegex } from "../utils/string";
import { getGeminiActiveQuotaLock, showGeminiQuotaToast } from "./breaker";
import { translationQueue } from "./queue";
import { DeeplChannelWorker, deeplWorkers, GeminiChannelWorker, geminiWorkers, resetAllWorkers, reScheduleAllWorkers } from "./worker";

export { translationQueue, reScheduleAllWorkers };

export function resetTranslationQueues() {
    translationQueue.reset();
    resetAllWorkers();
}

/**
 * Unified translation entry point with concurrency control.
 */
export async function translate(
    channelId: string,
    messageId: string,
    text: string,
    sourceLang: string,
    targetLang: string,
    engine: string,
    apiKeys: { deepl: string, gemini: string, deepseek: string },
    isManual = false
): Promise<string> {
    if (engine?.startsWith("gemini") || engine?.startsWith("deepseek")) {
        const isDeepSeek = engine.startsWith("deepseek");
        const engineKey = isDeepSeek ? apiKeys.deepseek : apiKeys.gemini;

        if (!isDeepSeek) {
            const activeLock = getGeminiActiveQuotaLock(engineKey);
            if (activeLock) {
                showGeminiQuotaToast(activeLock.kind, activeLock.until, isManual);
                return "";
            }
        }

        const result = await new Promise<string>(resolve => {
            const { config } = getChannelConfig(channelId);
            const dmPrompt = config?.aiCustomPrompt || "";

            if (!geminiWorkers.has(channelId)) {
                geminiWorkers.set(channelId, new GeminiChannelWorker(channelId));
            }

            const worker = geminiWorkers.get(channelId)!;
            const taskId = Math.random().toString(36).slice(2);
            worker.enqueue({
                id: taskId, messageId, channelId, text, resolve, targetLang, apiKey: engineKey, engine, dmPrompt, isManual
            });
            if (!messageId) {
                worker.flushNow();
            }
        });

        if (result !== "") {
            return result;
        }

        if (!isDeepSeek) {
            const retryLock = getGeminiActiveQuotaLock(engineKey);
            if (retryLock) showGeminiQuotaToast(retryLock.kind, retryLock.until, isManual);
        }

        return "";
    }

    // DeepL uses Batching
    if (engine === "deepl") {
        const result = await new Promise<string>(resolve => {
            const key = `deepl|||${sourceLang}|||${targetLang}|||${apiKeys.deepl}`;
            if (!deeplWorkers.has(key)) {
                deeplWorkers.set(key, new DeeplChannelWorker(key));
            }

            const worker = deeplWorkers.get(key)!;
            worker.enqueue({
                id: messageId, channelId, text, resolve, targetLang, apiKey: apiKeys.deepl, engine: "deepl", dmPrompt: ""
            });
            if (!messageId) {
                worker.flushNow();
            }
        });

        if (result !== "") {
            return result;
        }

        return "";
    }



    // Default fallback (should not be reached unless engine is unknown)
    return Promise.resolve("");
}



// --- Tokenizer Helpers ---
const PRESERVE_BASE = /<@[!&]?\d+>|<#\d+>|<[^>]+>|https?:\/\/[^\s]+|```[\s\S]*?```|`[^`]+`/gmu;
const PRESERVE_WITH_EMOJIS = /<a?:\w+:\d+>|[\p{Emoji_Presentation}\p{Extended_Pictographic}]+|<@[!&]?\d+>|<#\d+>|<[^>]+>|https?:\/\/[^\s]+|```[\s\S]*?```|`[^`]+`/gmu;

export function getGeminiBatchState(channelId: string, messageId: string) {
    const worker = geminiWorkers.get(channelId);
    if (!worker) return null;

    const task = worker.registry.get(messageId);
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

function tokenizeText(text: string, preserveEmojis: boolean): { textToTranslate: string, tokens: string[] } {
    const tokens: string[] = [];
    let textToTranslate = text;

    if (!preserveEmojis) {
        // Strip emojis completely from the text that will be translated
        textToTranslate = textToTranslate
            .replace(/<a?:\w+:\d+>/g, "")
            .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
    }

    const preserveRegex = preserveEmojis ? PRESERVE_WITH_EMOJIS : PRESERVE_BASE;

    textToTranslate = textToTranslate.replace(preserveRegex, match => {
        const id = tokens.length;
        tokens.push(match);
        return `{@${id}@}`;
    });

    return { textToTranslate, tokens };
}

function restoreTokens(text: string, tokens: string[]): string {
    return text.replace(/\{\s*@\s*(\d+)\s*@\s*\}/g, (match, idStr) => {
        const id = parseInt(idStr, 10);
        return tokens[id] !== undefined ? tokens[id] : match;
    });
}

// --- Dictionary Cache ---
let cachedDictHash = "";
let cachedDictRegex: RegExp | null = null;

function applyCustomDictionary(text: string, caseSensitive: boolean): string {
    const dict = CustomDictionaryStore.getInstance().getDict();
    const dictKeys = Object.keys(dict);

    if (dictKeys.length === 0) return text;

    // Cache invalidation logic
    const currentHash = dictKeys.join(",") + "_" + caseSensitive;
    if (currentHash !== cachedDictHash) {
        dictKeys.sort((a, b) => b.length - a.length);
        cachedDictRegex = getDictRegex(dictKeys, caseSensitive);
        cachedDictHash = currentHash;
    }

    if (cachedDictRegex) {
        return text.replace(cachedDictRegex, match => {
            const matchedKey = dictKeys.find(k => caseSensitive ? k === match : k.toLowerCase() === match.toLowerCase());
            return (matchedKey && dict[matchedKey]) ? dict[matchedKey] : match;
        });
    }

    return text;
}

export async function safeTranslate(
    content: string,
    sourceLang: string,
    targetLang: string,
    engine: string,
    apiKeys: { deepl: string, gemini: string, deepseek: string },
    channelId?: string,
    messageId?: string,
    isManual = false
): Promise<string | null> {
    if (!shouldTranslate(content, targetLang)) return null;

    // 1. Tokenize (Extract mentions, code blocks, emojis)
    let { textToTranslate, tokens } = tokenizeText(content.trim(), settings.store.preserveEmojis);

    // 2. Custom Dictionary Substitution
    textToTranslate = applyCustomDictionary(textToTranslate, settings.store.dictionaryCaseSensitive);

    // 3. Translate
    const result = await translate(
        channelId || "",
        messageId || "",
        textToTranslate,
        sourceLang,
        targetLang,
        engine,
        apiKeys,
        isManual
    );

    if (!result || result === textToTranslate) return null;

    // 4. Restore tokens
    return restoreTokens(result, tokens);
}
