/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { safeTranslate } from "../api/translate";
import { TranslationCache } from "../utils/cache";
import { Logger } from "../utils/logger";

interface UseTranslationExecutionProps {
    messageId: string;
    channelId: string;
    content: string;
    cacheKey: string;
    currentEngine: string;
    sourceLang: string;
    resolvedTarget: string;
    shouldTranslateContent: boolean;
    allowed: boolean;
    isManual: boolean;
    skipMessage: boolean;
    deeplApiKey?: string;
    geminiApiKey?: string;
    deepseekApiKey?: string;
    translationEngine: string;
    cachedTranslated: string | undefined;
    cacheRevision: number;
}

/**
 * Hook to manage the execution of the API translation request and caching logic.
 */
export function useTranslationExecution({
    messageId,
    channelId,
    content,
    cacheKey,
    currentEngine,
    sourceLang,
    resolvedTarget,
    shouldTranslateContent,
    allowed,
    isManual,
    skipMessage,
    deeplApiKey,
    geminiApiKey,
    deepseekApiKey,
    translationEngine,
    cachedTranslated,
    cacheRevision
}: UseTranslationExecutionProps) {
    const [translatedText, setTranslatedText] = useState<string | null>(cachedTranslated ?? null);
    const [isTranslating, setIsTranslating] = useState(false);

    // Sync state if cache updates synchronously (e.g. from manual batch)
    useEffect(() => {
        if (cachedTranslated && translatedText !== cachedTranslated) {
            setTranslatedText(cachedTranslated);
            setIsTranslating(false);
        }
    }, [cachedTranslated]);

    useEffect(() => {
        // If we already have the text from cache, we don't need to fetch
        if (cachedTranslated) {
            return;
        }

        if (!content || (!allowed && !isManual) || skipMessage || !shouldTranslateContent || currentEngine === "disable") {
            setIsTranslating(false);
            setTranslatedText(null);
            return;
        }

        let cancelled = false;
        let timeoutId: NodeJS.Timeout;

        const run = async () => {
            if (cancelled) return;

            setTranslatedText(null);

            const cache = TranslationCache.getInstance();
            const generation = cache.getGeneration(cacheKey);
            let promise = TranslationCache.getInstance().getPending(cacheKey, content);
            if (!promise) {
                promise = safeTranslate(
                    content,
                    sourceLang,
                    resolvedTarget,
                    currentEngine,
                    { deepl: deeplApiKey || "", gemini: geminiApiKey || "", deepseek: deepseekApiKey || "" },
                    channelId,
                    messageId,
                    isManual
                );
                TranslationCache.getInstance().setPending(cacheKey, content, promise);
            }

            setIsTranslating(true);
            try {
                const result = await promise;
                if (cache.getGeneration(cacheKey) !== generation) return;
                if (result) cache.set(cacheKey, result, currentEngine);
                if (!cancelled) setTranslatedText(result);
            } catch (e) {
                Logger.warn("Translate", "Translation request failed", e);
            } finally {
                if (!cancelled) setIsTranslating(false);
            }
        };

        // Scroll debounce: skip API calls if user scrolls past message quickly (DeepL specific)
        if (currentEngine === "deepl") {
            timeoutId = setTimeout(run, 500);
        } else {
            run();
        }

        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [
        cacheKey,
        cacheRevision,
        content,
        allowed,
        isManual,
        resolvedTarget,
        currentEngine,
        sourceLang,
        deeplApiKey,
        geminiApiKey,
        deepseekApiKey,
        translationEngine,
        skipMessage,
        shouldTranslateContent,
        cachedTranslated,
        channelId,
        messageId
    ]);

    return {
        translatedText,
        isTranslating
    };
}
