/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app,IpcMainInvokeEvent } from "electron";
import fs from "fs/promises";
import path from "path";

import { CACHE_PERSISTENT_MAX_SIZE } from "./constants";
import { CACHE_BYTE_BUDGET, CACHE_ENTRY_BYTE_LIMIT, CACHE_PATCH_ENTRY_LIMIT, cacheEntryBytes, type CachePatch } from "./utils/cachePolicy";

const requests = new Map<string, AbortController>();

async function translationFetch(event: IpcMainInvokeEvent, requestId: string, url: string, init: RequestInit, timeout: number) {
    const key = event.sender.id + ":" + requestId;
    const controller = new AbortController();
    requests.set(key, controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeout, 20_000));
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return { ok: res.ok, status: res.status, data: await res.text(), retryAfter: res.headers?.get("retry-after") ?? null };
    } catch (e) {
        return { ok: false, status: -1, data: timedOut ? "Translation timed out (20s)" : controller.signal.aborted ? "Translation cancelled" : "Network connection failed", retryAfter: null };
    } finally {
        clearTimeout(timer);
        requests.delete(key);
    }
}

export async function batCancelRequest(event: IpcMainInvokeEvent, requestId: string) {
    requests.get(event.sender.id + ":" + requestId)?.abort();
}

export async function batGeminiFetch(event: IpcMainInvokeEvent, apiUrl: string, apiKey: string, payload: string, requestId: string) {
    return translationFetch(event, requestId, `${apiUrl}?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: payload
        }, 300000);
}

export async function batDeepSeekFetch(event: IpcMainInvokeEvent, apiUrl: string, apiKey: string, payload: string, requestId: string) {
    return translationFetch(event, requestId, apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: payload
        }, 300000);
}

export async function batDeepSeekBalanceFetch(_: IpcMainInvokeEvent, apiKey: string) {
    try {
        const res = await fetch("https://api.deepseek.com/user/balance", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json"
            }
        });

        const text = await res.text();
        return { ok: res.ok, status: res.status, data: text };
    } catch (e) {
        return { ok: false, status: -1, data: String(e) };
    }
}

let cacheState: Promise<Map<string, { value: string; bytes: number }>> | null = null;
let cacheWrite: Promise<unknown> = Promise.resolve();

function trimCache(entries: Map<string, { value: string; bytes: number }>) {
    let bytes = 0;
    for (const entry of entries.values()) bytes += entry.bytes;
    while (entries.size > CACHE_PERSISTENT_MAX_SIZE || bytes > CACHE_BYTE_BUDGET) {
        const key = entries.keys().next().value!; bytes -= entries.get(key)!.bytes; entries.delete(key);
    }
}

function loadCacheState() {
    return cacheState ??= (async () => {
        const entries = new Map<string, { value: string; bytes: number }>();
        try {
            const parsed = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "AlwaysTranslateCache.json"), "utf-8"));
            if (parsed?.version === 3 && parsed.entries && typeof parsed.entries === "object") {
                for (const [key, value] of Object.entries(parsed.entries)) {
                    if (!key.startsWith("v3:") || typeof value !== "string") continue;
                    const bytes = cacheEntryBytes(key, value);
                    if (bytes <= CACHE_ENTRY_BYTE_LIMIT) entries.set(key, { value, bytes });
                }
                trimCache(entries);
            }
        } catch {}
        return entries;
    })();
}

function cacheSnapshot(entries: Map<string, { value: string; bytes: number }>) {
    return JSON.stringify({ version: 3, entries: Object.fromEntries(Array.from(entries, ([key, entry]) => [key, entry.value])) });
}

export async function batCacheLoad(_: IpcMainInvokeEvent): Promise<string> {
    await cacheWrite;
    return cacheSnapshot(await loadCacheState());
}

export function batCacheSave(_: IpcMainInvokeEvent, patch: CachePatch): Promise<boolean> {
    const operation = cacheWrite.then(async () => {
        if (patch?.version !== 3 || !Array.isArray(patch.entries) || patch.entries.length > CACHE_PATCH_ENTRY_LIMIT ||
            !patch.entries.every(([key, value]) => typeof key === "string" && key.startsWith("v3:") &&
                (value === null || (typeof value === "string" && cacheEntryBytes(key, value) <= CACHE_ENTRY_BYTE_LIMIT)))) {
            throw new Error("Invalid cache patch");
        }
        const entries = await loadCacheState();
        if (patch.clear) entries.clear();
        for (const [key, value] of patch.entries) {
            entries.delete(key);
            if (value !== null) entries.set(key, { value, bytes: cacheEntryBytes(key, value) });
        }
        if (patch.persist) {
            trimCache(entries);
            const destination = path.join(app.getPath("userData"), "AlwaysTranslateCache.json");
            const temporary = destination + ".tmp";
            try {
                await fs.writeFile(temporary, cacheSnapshot(entries), "utf-8");
                await fs.rename(temporary, destination);
            } catch (error) {
                await fs.unlink(temporary).catch(() => {});
                throw error;
            }
        }
        return true;
    }).catch(error => { console.error("[AlwaysTranslate] Failed to save cache:", error); return false; });
    cacheWrite = operation;
    return operation;
}
