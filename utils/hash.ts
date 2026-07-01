/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getChannelConfig } from "../settings";

// --- Fast String Hash (djb2) ---
export function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0; // Force unsigned 32-bit int
}

export function getCacheKey(
    channelId: string,
    messageId: string, // Kept for API compatibility, but ignored in hash
    engine: string,
    sourceLang: string,
    targetLang: string,
    sourceText: string
): string {
    const textHash = hashString(sourceText).toString(36);
    if (engine?.startsWith("gemini") || engine?.startsWith("deepseek")) {
        const config = channelId ? getChannelConfig(channelId).config : null;
        const dmPrompt = config?.aiCustomPrompt || "";
        const promptHash = hashString(dmPrompt).toString(36);
        let cId = channelId;
        try { cId = BigInt(channelId).toString(36); } catch {}
        // Omit messageId to ensure optimistic UI messages share the same cache key
        return `c${cId}_${targetLang}_${promptHash}_${textHash}`;
    }
    // Contextless engines (DeepL) share translations globally across all channels
    return `g_d_${targetLang}_${textHash}`;
}
