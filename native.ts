/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app,IpcMainInvokeEvent } from "electron";
import fs from "fs/promises";
import path from "path";

const requests = new Map<string, AbortController>();

async function translationFetch(event: IpcMainInvokeEvent, requestId: string, url: string, init: RequestInit, timeout: number) {
    const key = event.sender.id + ":" + requestId;
    const controller = new AbortController();
    requests.set(key, controller);
    const timer = setTimeout(() => controller.abort(), Math.min(timeout, 20_000));
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return { ok: res.ok, status: res.status, data: await res.text() };
    } catch (e) {
        return { ok: false, status: -1, data: controller.signal.aborted ? "Translation timed out or cancelled" : "Network connection failed" };
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

export async function batCacheLoad(_: IpcMainInvokeEvent): Promise<string | null> {
    try {
        const cachePath = path.join(app.getPath("userData"), "AlwaysTranslateCache.json");
        return await fs.readFile(cachePath, "utf-8");
    } catch {
        return null;
    }
}

export async function batCacheSave(_: IpcMainInvokeEvent, data: string): Promise<boolean> {
    try {
        const cachePath = path.join(app.getPath("userData"), "AlwaysTranslateCache.json");
        await fs.writeFile(cachePath, data, "utf-8");
        return true;
    } catch (e) {
        console.error("[AlwaysTranslate] Failed to save cache file:", e);
        return false;
    }
}
