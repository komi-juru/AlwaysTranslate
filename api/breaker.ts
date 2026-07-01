/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Toasts } from "@webpack/common";

import { type GeminiQuotaKind, type GeminiQuotaLockState,settings } from "../settings";
import { Logger } from "../utils/logger";

const recentToasts = new Map<string, number>();
const TOAST_DEDUP_WINDOW_MS = 1500;

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function shouldShowToast(key: string, cooldown = TOAST_DEDUP_WINDOW_MS) {
    const now = Date.now();
    const lastShown = recentToasts.get(key) ?? 0;
    if (now - lastShown < cooldown) {
        return false;
    }

    recentToasts.set(key, now);
    return true;
}

export function showApiToast(engine: string, reason: string, cooldown = TOAST_DEDUP_WINDOW_MS) {
    const message = `${capitalize(engine)}: ${reason}`;
    if (!shouldShowToast(message, cooldown)) return;

    Toasts.show({
        message,
        id: Toasts.genId(),
        type: Toasts.Type.FAILURE
    });
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).formatToParts(date);

    const offsetPart = parts.find(part => part.type === "timeZoneName")?.value ?? "GMT";
    const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;

    const sign = match[1] === "-" ? -1 : 1;
    const hours = parseInt(match[2], 10);
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    return sign * (hours * 60 + minutes);
}

export function getNextPacificMidnight(now = Date.now()) {
    const current = new Date(now);
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    const parts = formatter.formatToParts(current);
    const year = Number(parts.find(part => part.type === "year")?.value);
    const month = Number(parts.find(part => part.type === "month")?.value);
    const day = Number(parts.find(part => part.type === "day")?.value);

    const utcGuess = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), "America/Los_Angeles");
    return utcGuess - offsetMinutes * 60_000;
}

function formatDurationShort(ms: number) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    return `${hours}h`;
}

function formatLocalTime(ts: number) {
    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(ts));
}

function formatRelativeResetLabel(until: number) {
    const now = new Date();
    const target = new Date(until);

    const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    const dayDiff = Math.floor((targetDay - nowDay) / 86_400_000);

    if (dayDiff === 0) return "Today";
    if (dayDiff === 1) return "Tomorrow";

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric"
    }).format(target);
}

function getGeminiQuotaUntil(kind: GeminiQuotaKind, now = Date.now()) {
    if (kind === "rpm") return now + 60_000;
    if (kind === "tpm") return now + 60_000;
    return getNextPacificMidnight(now);
}

function getGeminiQuotaLocks() {
    if (!settings.store.geminiQuotaLocks) {
        settings.store.geminiQuotaLocks = {} as Record<string, GeminiQuotaLockState>;
    }

    return settings.store.geminiQuotaLocks;
}

function getGeminiQuotaState(apiKey: string): GeminiQuotaLockState {
    return getGeminiQuotaLocks()[apiKey] ?? {};
}

function writeGeminiQuotaState(apiKey: string, state: GeminiQuotaLockState) {
    const locks = { ...getGeminiQuotaLocks() };
    if (!state.rpmUntil && !state.tpmUntil && !state.rpdUntil) {
        delete locks[apiKey];
    } else {
        locks[apiKey] = state;
    }
    settings.store.geminiQuotaLocks = locks;
}

export function clearGeminiQuotaState(apiKey: string) {
    const locks = { ...getGeminiQuotaLocks() };
    delete locks[apiKey];
    settings.store.geminiQuotaLocks = locks;
}

export function getGeminiActiveQuotaLock(apiKey: string): { kind: GeminiQuotaKind; until: number } | null {
    const state = getGeminiQuotaState(apiKey);
    const now = Date.now();
    const active = [
        ["rpm", state.rpmUntil],
        ["tpm", state.tpmUntil],
        ["rpd", state.rpdUntil]
    ].filter((entry): entry is [GeminiQuotaKind, number] => typeof entry[1] === "number" && entry[1] > now);

    if (active.length === 0) {
        clearGeminiQuotaState(apiKey);
        return null;
    }

    active.sort((a, b) => b[1] - a[1]);
    return { kind: active[0][0], until: active[0][1] };
}

export function setGeminiQuotaLock(apiKey: string, kind: GeminiQuotaKind, until = getGeminiQuotaUntil(kind)) {
    const state = getGeminiQuotaState(apiKey);
    if (kind === "rpm") state.rpmUntil = until;
    if (kind === "tpm") state.tpmUntil = until;
    if (kind === "rpd") state.rpdUntil = until;
    writeGeminiQuotaState(apiKey, state);
    return until;
}

export function describeGeminiQuotaLock(kind: GeminiQuotaKind, until: number) {
    if (kind === "rpd") {
        return `Quota resets ${formatRelativeResetLabel(until)} at ${formatLocalTime(until)}`;
    }

    return `Rate limited (${formatDurationShort(until - Date.now())})`;
}

export function showGeminiQuotaToast(kind: GeminiQuotaKind, until: number, isManual = false) {
    const cooldown = isManual ? 1500 : 10 * 60 * 1000;
    showApiToast("gemini", describeGeminiQuotaLock(kind, until), cooldown);
}



export const APIBreaker = {
    reportError(
        engine: string,
        _apiKey: string,
        status: number | null,
        errorCode: string | null,
        errorMsg: string
    ): boolean {
        const lowerMsg = (errorMsg || "").toLowerCase();

        const statusMatch = lowerMsg.match(/api error:?\s*(\d+)/i) || lowerMsg.match(/status\s*(\d+)/i);
        const resolvedStatus = status || (statusMatch ? parseInt(statusMatch[1], 10) : null);

        if (
            resolvedStatus === 401 ||
            resolvedStatus === 403 ||
            errorCode === "API_KEY_INVALID" ||
            lowerMsg.includes("invalid api key") ||
            lowerMsg.includes("missing")
        ) {
            Logger.warn("CircuitBreaker", `[${engine}] Invalid API Key.`);
            showApiToast(engine, "Invalid key");
            return true;
        }

        if (
            resolvedStatus === 456 ||
            lowerMsg.includes("daily") ||
            lowerMsg.includes("per day") ||
            lowerMsg.includes("quota exceeded")
        ) {
            if (!lowerMsg.includes("per minute") && !lowerMsg.includes("minute") && !lowerMsg.includes("rpm") && !lowerMsg.includes("tpm")) {
                const reason = "Quota exceeded";
                Logger.warn("CircuitBreaker", `[${engine}] ${reason}.`);
                showApiToast(engine, reason);
                return true;
            }
        }

        if (
            resolvedStatus === 429 ||
            lowerMsg.includes("429") ||
            lowerMsg.includes("too many requests") ||
            lowerMsg.includes("per minute") ||
            lowerMsg.includes("minute") ||
            lowerMsg.includes("rpm") ||
            lowerMsg.includes("tpm") ||
            errorCode === "RESOURCE_EXHAUSTED" ||
            lowerMsg.includes("resource_exhausted")
        ) {
            Logger.warn("CircuitBreaker", `[${engine}] Rate limit exceeded.`);
            showApiToast(engine, "Rate limited");
            return true;
        }

        return false;
    }
};
