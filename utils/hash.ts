/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CustomDictionaryStore } from "../dict";
import { getChannelConfig, settings } from "../settings";

export function getCacheKey(
    channelId: string,
    _messageId: string, // Identical content may reuse a translation within the same channel.
    engine: string,
    sourceLang: string,
    targetLang: string,
    sourceText: string
): string {
    const config = channelId ? getChannelConfig(channelId).config : null;
    const model = engine.startsWith("gemini") ? settings.store.geminiModel
        : engine.startsWith("deepseek") ? settings.store.deepseekModel : "";
    const endpoint = engine.startsWith("deepseek") ? settings.store.deepseekBaseUrl : "";
    // Versioned, channel-scoped keys: no cross-engine or cross-prompt reuse.
    // Exact source text avoids hash collisions returning another message's translation.
    return getChannelCachePrefix(channelId) + JSON.stringify([
        engine, model, endpoint, sourceLang, targetLang, config?.aiCustomPrompt || "",
        CustomDictionaryStore.getInstance().getCacheSignature(),
        settings.store.dictionaryCaseSensitive, settings.store.hideEmojis,
        settings.store.hideMentions, sourceText
    ]);
}

export function getChannelCachePrefix(channelId: string): string {
    return "v3:" + channelId + ":";
}
