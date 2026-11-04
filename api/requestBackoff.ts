/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface RequestScope {
    engine: string;
    apiKey: string;
    model: string;
    endpoint: string;
}

const states = new Map<string, { until: number; failures: number; probing: boolean; reason: string }>();

export async function withRequestBackoff<T>(scope: RequestScope, request: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([scope.engine, scope.apiKey.trim(), scope.model, scope.endpoint]);
    const previous = states.get(key);
    if (previous && (previous.until > Date.now() || previous.probing)) {
        const seconds = Math.max(1, Math.ceil((previous.until - Date.now()) / 1000));
        throw Object.assign(new Error(previous.probing ? "API recovery check in progress. Try again shortly."
            : previous.reason + " Try again in " + seconds + "s."), { backoffUntil: previous.until });
    }
    if (previous) previous.probing = true;
    try {
        const result = await request();
        if (states.get(key) === previous) states.delete(key);
        return result;
    } catch (error) {
        const details = error as { status?: number; retryAfterMs?: number; message?: string; name?: string } | null;
        const message = details?.message ?? "";
        const cancelled = details?.name === "AbortError" || /cancelled|canceled/i.test(message);
        const rateLimited = details?.status === 429;
        const temporary = details?.status === -1 || (details?.status ?? 0) >= 500 || /network|fetch failed|timed out/i.test(message);
        const configuration = [400, 401, 402, 403, 404, 422].includes(details?.status ?? 0);
        if (!cancelled && (rateLimited || temporary || configuration)) {
            const failures = (states.get(key)?.failures ?? 0) + 1;
            const delay = configuration ? 60000 : Math.min(rateLimited ? 120000 : 30000,
                (rateLimited ? 10000 : 2000) * 2 ** Math.min(failures - 1, 6));
            states.delete(key);
            states.set(key, { until: Date.now() + Math.max(delay, details?.retryAfterMs ?? 0), failures, probing: false, reason: message || "API unavailable." });
            if (states.size > 100) states.delete(states.keys().next().value!);
        } else if (previous && states.get(key) === previous) {
            if (cancelled) previous.probing = false;
            else states.delete(key);
        }
        throw error;
    }
}
