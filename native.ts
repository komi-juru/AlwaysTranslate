/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app,IpcMainInvokeEvent } from "electron";
import fs from "fs/promises";
import path from "path";

export async function batDeeplFetch(_: IpcMainInvokeEvent, isFree: boolean, apiKey: string, payload: string) {
    const url = isFree
        ? "https://api-free.deepl.com/v2/translate"
        : "https://api.deepl.com/v2/translate";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            },
            body: payload
        });

        const text = await res.text();
        return { ok: res.ok, status: res.status, data: text };
    } catch (e) {
        return { ok: false, status: -1, data: String(e) };
    }
}

export async function batDeeplUsageFetch(_: IpcMainInvokeEvent, isFree: boolean, apiKey: string) {
    const url = isFree
        ? "https://api-free.deepl.com/v2/usage"
        : "https://api.deepl.com/v2/usage";

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            }
        });

        const text = await res.text();
        return { ok: res.ok, status: res.status, data: text };
    } catch (e) {
        return { ok: false, status: -1, data: String(e) };
    }
}

export async function batGeminiFetch(_: IpcMainInvokeEvent, apiUrl: string, apiKey: string, payload: string) {
    try {
        const res = await fetch(`${apiUrl}?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: payload
        });

        const text = await res.text();
        return { ok: res.ok, status: res.status, data: text };
    } catch (e) {
        return { ok: false, status: -1, data: String(e) };
    }
}

export async function batDeepSeekFetch(_: IpcMainInvokeEvent, apiUrl: string, apiKey: string, payload: string) {
    try {
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: payload
        });

        const text = await res.text();
        return { ok: res.ok, status: res.status, data: text };
    } catch (e) {
        return { ok: false, status: -1, data: String(e) };
    }
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

export async function batDictLoad(_: IpcMainInvokeEvent): Promise<string | null> {
    try {
        const dictPath = path.join(app.getPath("userData"), "AlwaysTranslateDict.json");
        return await fs.readFile(dictPath, "utf-8");
    } catch {
        return null;
    }
}

export async function batDictSave(_: IpcMainInvokeEvent, data: string): Promise<boolean> {
    try {
        const dictPath = path.join(app.getPath("userData"), "AlwaysTranslateDict.json");
        await fs.writeFile(dictPath, data, "utf-8");
        return true;
    } catch (e) {
        console.error("[AlwaysTranslate] Failed to save dictionary file:", e);
        return false;
    }
}
