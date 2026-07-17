/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Parser, useEffect,UserStore, useState } from "@webpack/common";

import { useManualTranslation } from "../hooks/useManualTranslation";
import { useMessageVisibility } from "../hooks/useMessageVisibility";
import { useTranslationExecution } from "../hooks/useTranslationExecution";
import { pluginStarted } from "../index";
import { getChannelConfig, settings } from "../settings";
import { TranslationCache } from "../utils/cache";
import { getCacheKey, hashString } from "../utils/hash";
import { shouldTranslate } from "../utils/message";
import { LoadingIndicator } from "./LoadingIndicator";

const CodeContainerClasses = findCssClassesLazy("markup");

export function TranslationAccessory({ message }: { message: Message }) {
    if (!pluginStarted) return null;

    const {
        hideOriginal,
        showSeparator,
        translationColor,
        translationEngine,
        targetLang,
        deeplApiKey,
        geminiApiKey,
        deepseekApiKey,
        skipOwnMessages,
        enableTranslation,
        channelList,
        translationMode,
        manualTranslationEngine,
        hideEmojis,
        _cacheVersion
    } = settings.use([
        "hideOriginal",
        "showSeparator",
        "translationColor",
        "translationEngine",
        "targetLang",
        "deeplApiKey",
        "geminiApiKey",
        "deepseekApiKey",
        "skipOwnMessages",
        "enableTranslation",
        "channelList",
        "translationMode",
        "manualTranslationEngine",
        "hideEmojis",
        "_cacheVersion"
    ]);

    const { allowed, config } = getChannelConfig(message.channel_id);

    const sourceLang = config?.lang ?? "auto";
    let resolvedTarget = targetLang;
    if (resolvedTarget === "auto") {
        resolvedTarget = document.documentElement.lang.split("-")[0] || "en";
    }

    const activeManualEngine = manualTranslationEngine === "disable"
        ? "gemini"
        : manualTranslationEngine;

    // Quick skip checks for own messages and optimistic messages
    const isOwnMessage = skipOwnMessages && message.author?.id === UserStore.getCurrentUser()?.id;
    const isOptimistic = !/^\d{17,20}$/.test(message.id) || message.state === "SENDING";
    const skipMessage = isOwnMessage || isOptimistic || !message.content;
    const shouldTranslateContent = !skipMessage && shouldTranslate(message.content, resolvedTarget);

    let autoEngine = config?.engine ?? translationEngine;
    if (autoEngine === "default") autoEngine = translationEngine;

    // Cache keys are engine-specific:
    // - Gemini uses persistent cache
    // - DeepL uses volatile cache
    const autoCacheKey = getCacheKey(message.channel_id, message.id, autoEngine, sourceLang, resolvedTarget, message.content);
    const manualCacheKey = getCacheKey(message.channel_id, message.id, activeManualEngine, sourceLang, resolvedTarget, message.content);

    // Manual Translation Hook
    const { isManual } = useManualTranslation({
        enableTranslation,
        // Since we hoist `isTranslating`, we need to break the circular dependency.
        // We can pass false here if we don't have it yet, or use a ref.
        // Actually, we can just check pending cache directly in the hook
        isTranslating: false, // We'll rely on pending cache check instead
        manualCacheKey,
        shouldTranslateContent,
        content: message.content
    });

    const [renderTick, setForceRender] = useState(0);

    let activeEngine = isManual ? activeManualEngine : autoEngine;
    let cacheKey = isManual ? manualCacheKey : autoCacheKey;
    let cachedTranslated = TranslationCache.getInstance().peek(cacheKey);

    // Outgoing cache fast-path: instantly display own sent translations
    if (!cachedTranslated && !isManual) {
        const outgoingHit = TranslationCache.getInstance().outgoingCache.get(message.content.trim());
        if (outgoingHit) {
            cachedTranslated = outgoingHit;
            TranslationCache.getInstance().set(cacheKey, outgoingHit, activeEngine);
        }
    }

    // Prioritize Gemini cache over DeepL if the user previously manually translated it
    if (!isManual && autoEngine !== "disable" && !(autoEngine.startsWith("gemini") || autoEngine.startsWith("deepseek")) && (activeManualEngine.startsWith("gemini") || activeManualEngine.startsWith("deepseek"))) {
        const manualCached = TranslationCache.getInstance().peek(manualCacheKey);
        if (manualCached) {
            activeEngine = activeManualEngine;
            cacheKey = manualCacheKey;
            cachedTranslated = manualCached;
        }
    }

    // If manual mode is active, watch the auto engine's pending promise so we can upgrade when it finishes
    useEffect(() => {
        if (isManual && autoEngine !== activeManualEngine && (autoEngine.startsWith("gemini") || autoEngine.startsWith("deepseek")) && !TranslationCache.getInstance().peek(autoCacheKey)) {
            const pending = TranslationCache.getInstance().getPending(autoCacheKey, message.content);
            if (pending) {
                let isMounted = true;
                pending.then(() => {
                    if (isMounted) setForceRender(prev => prev + 1);
                });
                return () => { isMounted = false; };
            }
        }
    }, [isManual, autoEngine, activeManualEngine, autoCacheKey, message.content]);

    // Only override manual translation if auto engine is Gemini and has finished,
    // AND we want to prioritize it (e.g. auto is Gemini but manual was just a fallback).
    if (isManual && autoEngine !== activeManualEngine && (autoEngine.startsWith("gemini") || autoEngine.startsWith("deepseek"))) {
        const autoCached = TranslationCache.getInstance().peek(autoCacheKey);
        if (autoCached) {
            activeEngine = autoEngine;
            cacheKey = autoCacheKey;
            cachedTranslated = autoCached;
        }
    }
    // User wants to completely prevent DeepL from translating if a DeepSeek/Gemini translation exists.
    // So we check the shared cache unconditionally.
    const sharedCached = TranslationCache.getInstance().peekShared(resolvedTarget, hashString(message.content).toString(36));
    if (sharedCached) {
        cachedTranslated = sharedCached;
    }
    // Execution Hook
    const { translatedText, isTranslating } = useTranslationExecution({
        messageId: message.id,
        channelId: message.channel_id,
        content: message.content,
        cacheKey,
        currentEngine: activeEngine,
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
        cachedTranslated
    });

    // Visibility Hook (DOM side-effects)
    useMessageVisibility({
        messageId: message.id,
        allowed,
        hideOriginal,
        isTranslating,
        translatedText
    });

    // If channel is disabled or no translation yet, render nothing
    if (activeEngine === "disable") return null;
    if (!allowed && !isManual) return null;
    if (!translatedText && !isTranslating) return null;

    const customColor = translationColor || "#9aff99";
    const displayColor = hideOriginal ? undefined : customColor;
    const topMargin = hideOriginal ? 0 : 4;

    const containerClasses = `bat-translation ${hideOriginal ? CodeContainerClasses.markup : ""}`.trim();

    if (isTranslating && !translatedText) {
        return (
            <LoadingIndicator
                displayColor={customColor}
                topMargin={topMargin}
                hideOriginal={hideOriginal}
                showSeparator={showSeparator}
                isGemini={activeEngine.startsWith("gemini") || activeEngine.startsWith("deepseek")}
                messageId={message.id}
                channelId={message.channel_id}
            />
        );
    }

    let displayText = translatedText;

    if (!hideOriginal) {
        if (hideEmojis) {
            displayText = displayText
                .replace(/<a?:\w+:\d+>/g, "")
                .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
        }
        displayText = displayText.replace(/https?:\/\/[^\s>]+/g, "");
    }

    return (
        <div className={containerClasses} style={{ color: displayColor, marginTop: topMargin }}>
            {(!hideOriginal && showSeparator) && <div className="bat-separator" />}
            {Parser.parse(displayText)}
        </div>
    );
}
