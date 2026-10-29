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
import { httpError } from "./errors";
import { nativeRequest } from "./nativeRequest";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export async function translateWithDeepL(
    texts: string[],
    sourceLang: string,
    targetLang: string,
    apiKey: string,
    signal?: AbortSignal
): Promise<string[]> {
    if (!apiKey) throw new Error("DeepL API Key is missing.");

    const isFree = apiKey.endsWith(":fx");


    const payload = JSON.stringify({
        text: texts,
        target_lang: toDeepLLang(targetLang, false),
        ...(sourceLang !== "auto" && { source_lang: toDeepLLang(sourceLang, true) }),
    });

    const res = await nativeRequest(id => Native.batDeeplFetch(isFree, apiKey.trim(), payload, id), signal);
    if (!res.ok) throw httpError(res.status, String(res.data));

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
        if (!res.ok) throw httpError(res.status, String(res.data));
        const data = JSON.parse(res.data);
        return { count: data.character_count, limit: isFree ? 500000 : data.character_limit };
    } catch (e) {
        Logger.error("DeepL", "Failed to parse usage", e);
        return null;
    }
}
