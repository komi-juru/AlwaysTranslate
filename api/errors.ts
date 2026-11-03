/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const TRANSLATION_TIMEOUT_MS = 20_000;

export function describeApiError(status: number | null, code: string | null, message: string): string {
    const text = message.toLowerCase();
    if (/timeout|timed out|time limit/.test(text)) return "Translation timed out (20s)";
    if (/api key.*missing|missing api key/.test(text)) return "API key missing";
    if (code === "API_KEY_INVALID" || /api.?key.*(?:invalid|not valid)|invalid.*api.?key|invalid auth/.test(text) || status === 401) return "Invalid API key";
    if (status === 403) return "Access denied: check API permissions or region";
    if (status === 402) return "Insufficient API balance";
    if (status === 404) return "Model or API endpoint not found";
    if (status === 456 || /quota exceeded|daily|per day/.test(text)) return "API quota exceeded";
    if (status === 429 || code === "RESOURCE_EXHAUSTED" || /rate limit|too many requests/.test(text)) return "API rate limit exceeded";
    if (status !== null && status >= 500) return "API server unavailable";
    if (status === -1 || /network|fetch failed|enotfound|econnreset|failed to fetch/.test(text)) return "Network connection failed";
    if (/safety|blocked/.test(text)) return "Translation blocked by content filter";
    if (/empty response|missing content/.test(text)) return "API returned no translation";
    if (/parse|invalid response|json/.test(text)) return "Invalid API response";
    if (status === 400 || status === 422) return "Invalid API request: check model and language";
    if (/abort|cancel/.test(text)) return "Translation cancelled";
    return status ? `API request failed (HTTP ${status})` : "Translation failed";
}

export function httpError(status: number, raw: string) {
    let code: string | null = null;
    let message = raw;
    try {
        const body = JSON.parse(raw);
        message = body.error?.message ?? body.message ?? raw;
        code = body.error?.details?.find((detail: { reason?: string }) => detail.reason)?.reason ?? body.error?.code ?? null;
    } catch {}
    return Object.assign(new Error(describeApiError(status, code, message)), { status, code });
}
