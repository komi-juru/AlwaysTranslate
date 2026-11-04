/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Message } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Parser, UserStore } from "@webpack/common";

import { useMessageVisibility } from "../hooks/useMessageVisibility";
import { useTranslationExecution } from "../hooks/useTranslationExecution";
import { pluginStarted } from "../index";
import { getChannelConfig, settings } from "../settings";
import { TranslationCache } from "../utils/cache";
import { getCacheKey } from "../utils/hash";
import { shouldTranslate } from "../utils/message";
import { LoadingIndicator } from "./LoadingIndicator";

const CodeContainerClasses = findCssClassesLazy("markup");

export const TranslationAccessory = ErrorBoundary.wrap(function TranslationAccessory({ message }: { message: Message }) {
    if (!pluginStarted) return null;

    const {
        hideOriginal,
        showSeparator,
        translationColor,
        translationEngine = "gemini",
        targetLang = "auto",
        geminiApiKey,
        deepseekApiKey,
        skipOwnMessages,
        hideEmojis,
        _cacheVersion
    } = settings.use([
        "hideOriginal",
        "showSeparator",
        "translationColor",
        "translationEngine",
        "targetLang",
        "geminiApiKey",
        "deepseekApiKey",
        "skipOwnMessages",
        "channelList",
        "translationMode",
        "hideEmojis",
        "geminiModel",
        "deepseekModel",
        "deepseekBaseUrl",
        "hideMentions",
        "_cacheVersion"
    ]);

    const { allowed, config } = getChannelConfig(message.channel_id);

    const sourceLang = config?.lang ?? "auto";
    let resolvedTarget: string = targetLang;
    if (resolvedTarget === "auto") {
        resolvedTarget = document.documentElement.lang.split("-")[0] || "en";
    }

    // Quick skip checks for own messages and optimistic messages
    const isOwnMessage = skipOwnMessages && message.author?.id === UserStore.getCurrentUser()?.id;
    const isOptimistic = !/^\d{17,20}$/.test(message.id) || message.state === "SENDING";
    const skipMessage = isOwnMessage || isOptimistic || !message.content;
    const shouldTranslateContent = !skipMessage && shouldTranslate(message.content, resolvedTarget);

    const activeEngine = !config?.engine || config.engine === "default" ? translationEngine : config.engine;

    const cacheKey = getCacheKey(message.channel_id, message.id, activeEngine, sourceLang, resolvedTarget, message.content);
    let cachedTranslated = TranslationCache.getInstance().peek(cacheKey);

    // Outgoing cache fast-path: instantly display own sent translations
    if (!cachedTranslated && message.author?.id === UserStore.getCurrentUser()?.id) {
        const outgoingHit = TranslationCache.getInstance().getOutgoing(message.channel_id, message.content);
        if (outgoingHit) {
            cachedTranslated = outgoingHit;
        }
    }

    // Execution Hook
    const { translatedText, isTranslating, error, retry } = useTranslationExecution({
        messageId: message.id,
        channelId: message.channel_id,
        content: message.content,
        cacheKey,
        currentEngine: activeEngine,
        sourceLang,
        resolvedTarget,
        shouldTranslateContent,
        allowed,
        skipMessage,
        geminiApiKey,
        deepseekApiKey,
        cachedTranslated,
        cacheRevision: _cacheVersion
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
    if (!allowed) return null;
    if (error && !isTranslating) {
        return (
            <button className="bat-translation-retry" type="button" title={error}
                aria-label="번역 재시도" onClick={retry}>
                번역 실패 <span aria-hidden="true">↻</span>
            </button>
        );
    }
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
                messageId={message.id}
                channelId={message.channel_id}
            />
        );
    }

    let displayText = translatedText || "";

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
            {Parser.parse(displayText, true, {
                channelId: message.channel_id,
                messageId: message.id
            })}
        </div>
    );
}, { noop: true });
