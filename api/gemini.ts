/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { GEMINI_TEMPERATURE } from "../constants";
import { settings } from "../settings";
import { Logger } from "../utils/logger";
import { buildBatchTranslationPrompt, buildBatchUserPromptContext } from "./geminiPrompt";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export interface PartialMessage {
    id: string;
    content: string;
    author?: { username?: string };
}

const getApiUrl = () => {
    const model = settings.store.geminiModel || "gemini-3.1-flash-lite";
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
};

function simplifyGeminiError(status: number, rawText: string): string {
    const lower = rawText.toLowerCase();

    if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("missing")) {
        return "Gemini API key is invalid.";
    }

    if (status === 429 || lower.includes("resource_exhausted") || lower.includes("quota exceeded") || lower.includes("too many requests")) {
        return "Gemini quota exceeded.";
    }

    if (lower.includes("safety filters") || lower.includes("blocked by safety")) {
        return "Gemini blocked the response for safety reasons.";
    }

    if (lower.includes("network request failed") || lower.includes("fetch failed")) {
        return "Gemini network request failed.";
    }

    if (lower.includes("invalid response format")) {
        return "Gemini returned an invalid response.";
    }

    return `Gemini request failed (${status}).`;
}

function classifyGeminiQuota(rawText: string, errData: any): GeminiQuotaKind | null {
    const parts: string[] = [];
    if (rawText) parts.push(rawText);
    if (errData?.error?.message) parts.push(String(errData.error.message));
    if (errData?.error?.details) parts.push(JSON.stringify(errData.error.details));

    const text = parts.join(" ").toLowerCase();

    if (
        text.includes("per day") ||
        text.includes("daily") ||
        text.includes("rpd") ||
        text.includes("requestsperday") ||
        text.includes("perday")
    ) {
        return "rpd";
    }

    if (
        text.includes("token") ||
        text.includes("tpm") ||
        text.includes("tokens per minute") ||
        text.includes("input tokens") ||
        text.includes("output tokens") ||
        text.includes("tokensperminute")
    ) {
        return "tpm";
    }

    if (
        text.includes("per minute") ||
        text.includes("rpm") ||
        text.includes("requestsperminute") ||
        text.includes("minute") ||
        text.includes("retrydelay")
    ) {
        return "rpm";
    }

    return null;
}



// --- Helper: Unified API Fetch & Error Handling ---
async function fetchGeminiAPI(payload: any, engine: string, apiKey: string): Promise<any> {
    if (!apiKey) throw new Error("Gemini API Key is missing.");

    const apiUrl = getApiUrl();

    let res;
    try {
        res = await Native.batGeminiFetch(apiUrl, apiKey, JSON.stringify(payload));
    } catch (e) {
        Logger.warn("Gemini", "Network error during fetch", e);
        throw new Error("Gemini API network request failed");
    }

    if (!res.ok) {
        // Parse Structured Errors
        let isDailyQuota = false;
        let errData: any = null;
        try {
            errData = JSON.parse(res.data);
            if (res.status === 429 && errData?.error?.status === "RESOURCE_EXHAUSTED") {
                const details = JSON.stringify(errData.error.details || []);
                const msg = errData.error.message || "";
                // Only treat as daily if it explicitly says per day or daily
                if (msg.includes("per day") || details.includes("per day") || msg.includes("daily")) {
                    isDailyQuota = true;
                }
            }
        } catch (e) {
            // Fallback parsing
            if (res.status === 429 && res.data?.includes("per day")) {
                isDailyQuota = true;
            }
        }

        let quotaKind: GeminiQuotaKind | null = null;
        if (res.status === 429) {
            quotaKind = classifyGeminiQuota(String(res.data), errData);
        }

        if (quotaKind || isDailyQuota) {
            const quotaMessage = quotaKind === "rpd"
                ? "Gemini quota exceeded."
                : quotaKind === "tpm"
                    ? "Gemini token limit exceeded."
                    : "Gemini rate limit exceeded.";

            const err = new Error(quotaMessage) as Error & { quotaKind?: GeminiQuotaKind };
            err.quotaKind = quotaKind || "rpd";
            throw err;
        }

        throw new Error(simplifyGeminiError(res.status, String(res.data)));
    }

    try {
        const data = JSON.parse(res.data);
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            Logger.warn("Gemini", "Safety filter triggered or empty response", data);
            throw new Error("Response was blocked by safety filters or missing content");
        }

        return text.trim();
    } catch (e: any) {
        if (e.message?.includes("Quota Exceeded")) throw e;
        Logger.warn("Gemini", "Failed to parse API response", e);
        throw new Error("Gemini returned an invalid response.");
    }
}




export async function translateBatchWithGemini(
    channelId: string,
    messagesToTranslate: { id: string, text: string }[],
    targetLang: string,
    apiKey: string,
    customPrompt: string,
    engine: string
): Promise<{ id: string, text: string }[]> {
    const systemInstruction = buildBatchTranslationPrompt(targetLang, customPrompt);
    const userPrompt = buildBatchUserPromptContext(messagesToTranslate);

    const payload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
            temperature: GEMINI_TEMPERATURE,
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        id: { type: "STRING" },
                        text: { type: "STRING" }
                    },
                    required: ["id", "text"]
                }
            }
        }
    };

    const text = await fetchGeminiAPI(payload, engine, apiKey);

    // Extract JSON array using regex to bypass conversational filler
    let jsonStr = text;
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
        jsonStr = match[0];
    } else {
        // Fallback: aggressive trim
        jsonStr = text.replace(/^[\s\S]*?(?=\[\s*\{)/, "").replace(/\][\s\S]*$/, "]");
    }

    // Robust JSON Sanitization: Fix literal newlines and unescaped quotes generated by LLMs
    jsonStr = jsonStr.replace(/"text"\s*:\s*"([\s\S]*?)"(?=\s*\})/g, (match, p1) => {
        const fixedText = p1
            .replace(/\\"/g, '"') // Unescape already escaped quotes to avoid double escaping
            .replace(/"/g, '\\"') // Escape all quotes
            .replace(/\n/g, "\\n") // Escape literal newlines
            .replace(/\r/g, "\\r") // Escape literal carriage returns
            .replace(/\t/g, "\\t"); // Escape literal tabs
        return `"text": "${fixedText}"`;
    });

    try {
        const parsed = JSON.parse(jsonStr.trim());
        if (!Array.isArray(parsed)) throw new Error("Output is not an array");
        return parsed;
    } catch (e: any) {
        Logger.error(
            "GeminiBatch",
            `JSON parse error for batch array. Matched text: ${jsonStr.slice(0, 120)} | Raw text: ${text.slice(0, 120)}`,
            e
        );
        throw new Error(`Failed to parse Gemini API batch array: ${e.message}. Extracted: ${jsonStr.slice(0, 50)}...`);
    }
}
