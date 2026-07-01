/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Normalize a language code to a DeepL-compatible format.
 */
function toDeepLLang(lang: string, isSource: boolean): string {
    const upper = lang.toUpperCase();

    // DeepL uses "EN-US"/"EN-GB" for target but just "EN" for source
    if (upper === "EN") return isSource ? "EN" : "EN-US";
    // DeepL doesn't distinguish zh variants
    if (upper === "ZH-CN" || upper === "ZH-TW") return "ZH";

    return upper;
}

import { PluginNative } from "@utils/types";

import { Logger } from "../utils/logger";

// Vencord Native Helper for CORS bypass
const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export async function translateWithDeepL(
    texts: string[],
    sourceLang: string,
    targetLang: string,
    apiKey: string
): Promise<string[]> {
    if (!apiKey) throw new Error("DeepL API Key is missing.");

    const isFree = apiKey.endsWith(":fx");


    const payload = JSON.stringify({
        text: texts,
        target_lang: toDeepLLang(targetLang, false),
        ...(sourceLang !== "auto" && { source_lang: toDeepLLang(sourceLang, true) }),
    });

    const res = await Native.batDeeplFetch(isFree, apiKey.trim(), payload);
    if (!res.ok) {
        const raw = String(res.data || "");
        const lower = raw.toLowerCase();

        if (res.status === 401 || res.status === 403 || lower.includes("invalid auth") || lower.includes("authorization")) {
            throw new Error("DeepL API key is invalid.");
        }

        if (res.status === 429 || lower.includes("too many requests") || lower.includes("rate limit")) {
            throw new Error("DeepL rate limit exceeded.");
        }

        if (res.status === 456 || lower.includes("quota")) {
            throw new Error("DeepL quota exceeded.");
        }

        throw new Error(`DeepL request failed (${res.status}): ${raw}`);
    }

    try {
        const data = JSON.parse(res.data);
        return data.translations.map((t: { text?: string }) => t.text || "");
    } catch (e) {
        Logger.error("DeepL", "Failed to parse API response", e);
        throw new Error("Failed to parse DeepL API response");
    }
}

export async function getDeepLUsage(apiKey: string): Promise<{ count: number, limit: number } | null> {
    if (!apiKey) return null;
    const isFree = apiKey.endsWith(":fx");

    try {
        const res = await Native.batDeeplUsageFetch(isFree, apiKey.trim());
        if (!res.ok) {
            Logger.error("DeepL", `Usage fetch failed: ${res.status}`, res.data);
            return null;
        }

        const data = JSON.parse(res.data);
        return {
            count: data.character_count,
            limit: isFree ? 500000 : data.character_limit
        };
    } catch (e) {
        Logger.error("DeepL", "Failed to parse usage", e);
        return null;
    }
}
