/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

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
    skipMessage: boolean;
    geminiApiKey?: string;
    deepseekApiKey?: string;
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
    skipMessage,
    geminiApiKey,
    deepseekApiKey,
    cachedTranslated,
    cacheRevision
}: UseTranslationExecutionProps) {
    const [translatedText, setTranslatedText] = useState<string | null>(cachedTranslated ?? null);
    const [isTranslating, setIsTranslating] = useState(false);

    const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);
    const inFlight = useRef(false);
    const requestKey = cacheKey + ":" + messageId;

    // Sync state when a cached translation becomes available
    useEffect(() => {
        if (cachedTranslated && allowed && currentEngine !== "disable") {
            const cache = TranslationCache.getInstance();
            if (cache.get(cacheKey) === cachedTranslated) cache.rememberDisplayed(channelId, messageId, content, resolvedTarget, cacheKey);
        }
        if (cachedTranslated && translatedText !== cachedTranslated) {
            setTranslatedText(cachedTranslated);
            setIsTranslating(false);
            setFailure(null);
        }
    }, [cachedTranslated, cacheKey, allowed, currentEngine, channelId, messageId, content, resolvedTarget]);

    useEffect(() => {
        setFailure(null);
        inFlight.current = false;
        // If we already have the text from cache, we don't need to fetch
        if (cachedTranslated) {
            return;
        }

        if (!content || !allowed || skipMessage || !shouldTranslateContent || currentEngine === "disable") {
            setIsTranslating(false);
            setTranslatedText(null);
            return;
        }

        let cancelled = false;

        const run = async () => {
            if (cancelled) return;

            setTranslatedText(null);
            inFlight.current = true;

            const cache = TranslationCache.getInstance();
            const generation = cache.watchGeneration(cacheKey);
            let promise = cache.getPending(cacheKey, content);
            if (!promise) {
                promise = safeTranslate(
                    content,
                    sourceLang,
                    resolvedTarget,
                    currentEngine,
                    { gemini: geminiApiKey || "", deepseek: deepseekApiKey || "" },
                    channelId,
                    messageId
                );
                cache.setPending(cacheKey, content, promise);
            }

            setIsTranslating(true);
            try {
                const result = await promise;
                if (!generation.isCurrent()) return;
                if (result) cache.set(cacheKey, result, currentEngine);
                if (!cancelled) {
                    if (result) cache.rememberDisplayed(channelId, messageId, content, resolvedTarget, cacheKey);
                    setTranslatedText(result);
                }
            } catch (e) {
                Logger.warn("Translate", "Translation request failed", e);
                if (!cancelled && generation.isCurrent()) setFailure({ key: requestKey, message: e instanceof Error ? e.message : "Translation failed" });
            } finally {
                generation.release();
                if (!cancelled) {
                    inFlight.current = false;
                    setIsTranslating(false);
                }
            }
        };

        run();

        return () => {
            cancelled = true;
            inFlight.current = false;
        };
    }, [
        cacheKey,
        requestKey,
        retryVersion,
        cacheRevision,
        content,
        allowed,
        resolvedTarget,
        currentEngine,
        sourceLang,
        geminiApiKey,
        deepseekApiKey,
        skipMessage,
        shouldTranslateContent,
        cachedTranslated,
        channelId,
        messageId
    ]);

    useEffect(() => {
        if (!failure || failure.key !== requestKey || translatedText) return;
        const retryFailed = () => {
            if (inFlight.current || !allowed || skipMessage || !shouldTranslateContent || currentEngine === "disable") return;
            inFlight.current = true;
            setFailure(null);
            setRetryVersion(version => version + 1);
        };
        const event = "bat-retry-failed-" + channelId;
        window.addEventListener(event, retryFailed);
        return () => window.removeEventListener(event, retryFailed);
    }, [failure, requestKey, translatedText, channelId, allowed, skipMessage, shouldTranslateContent, currentEngine]);

    return {
        translatedText,
        isTranslating,
        error: !translatedText && failure?.key === requestKey ? failure.message : null,
        retry: () => {
            if (inFlight.current || failure?.key !== requestKey || !allowed || skipMessage || !shouldTranslateContent || currentEngine === "disable") return;
            window.dispatchEvent(new Event("bat-retry-failed-" + channelId));
        }
    };
}
