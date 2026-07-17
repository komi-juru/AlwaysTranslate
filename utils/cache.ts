/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { CACHE_MAX_SIZE, CACHE_PERSISTENT_MAX_SIZE, CACHE_SAVE_DEBOUNCE } from "../constants";
import { Logger } from "./logger";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export class TranslationCache {
    private static instance: TranslationCache | null = null;

    private volatileCache = new Map<string, string>();
    private persistentCache = new Map<string, string>();
    private sharedCache = new Map<string, string>();
    public outgoingCache = new Map<string, string>();
    public cacheRevision = 0;

    private pending = new Map<string, { source: string, promise: Promise<string | null> }>();
    private readonly maxSize: number;
    private saveTimeout: NodeJS.Timeout | null = null;
    private isDirty = false;
    private savePromise: Promise<void> = Promise.resolve();

    private constructor(maxSize = CACHE_MAX_SIZE) {
        this.maxSize = maxSize;
    }

    public static getInstance(): TranslationCache {
        if (!this.instance) {
            this.instance = new TranslationCache();
        }
        return this.instance;
    }

    public async init() {
        await this.loadFromStorage();
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleBeforeUnload = () => {
        if (this.isDirty) {
            this.performNativeSave();
        }
    };

    private extractLangAndHash(key: string): string | null {
        const parts = key.split("_");
        if (key.startsWith("c") && parts.length >= 4) {
            return `${parts[1]}_${parts[3]}`;
        }
        return null;
    }

    private migrateKey(key: string): string {
        // chan_1234|||gemini_ko_1234_5678 -> cXXX_ko_XXX_XXX
        const match = key.match(/^chan_(\d+)\|\|\|gemini_([a-z]+)_(\d+)_(\d+)$/);
        if (match) {
            const channelId = match[1];
            const targetLang = match[2];
            const promptHash = parseInt(match[3], 10).toString(36);
            const textHash = parseInt(match[4], 10).toString(36);
            let shortChan = channelId;
            try { shortChan = BigInt(channelId).toString(36); } catch {}
            return `c${shortChan}_${targetLang}_${promptHash}_${textHash}`;
        }
        // If it's already a new format or unmatched, return as is
        return key;
    }

    private async loadFromStorage() {
        try {
            const data = await Native.batCacheLoad();
            if (data) {
                const parsed = JSON.parse(data);

                if (parsed.version === 2 && parsed.entries) {
                    // Version 2: Flat object
                    let filtered = false;
                    for (const [key, translated] of Object.entries(parsed.entries)) {
                        if (key.startsWith("c")) {
                            const newKey = this.migrateKey(key);
                            if (newKey !== key) filtered = true;
                            this.persistentCache.set(newKey, translated as string);
                            const sharedKey = this.extractLangAndHash(newKey);
                            if (sharedKey) this.sharedCache.set(sharedKey, translated as string);
                        } else {
                            filtered = true; // Dropping deepl
                        }
                    }
                    if (filtered) {
                        this.isDirty = true;
                        this.saveToStorage();
                    }
                } else if (Array.isArray(parsed)) {
                    // Legacy migration: Array of [key, { source, translated, isPersistent }]
                    for (const [key, val] of parsed) {
                        if (val && val.translated && (key.includes("gemini") || key.startsWith("c"))) {
                            const newKey = this.migrateKey(key);
                            this.persistentCache.set(newKey, val.translated);
                            const sharedKey = this.extractLangAndHash(newKey);
                            if (sharedKey) this.sharedCache.set(sharedKey, val.translated);
                        }
                    }
                    this.isDirty = true;
                    this.saveToStorage();
                }

                // Enforce persistent LRU
                while (this.persistentCache.size > CACHE_PERSISTENT_MAX_SIZE) {
                    const oldest = this.persistentCache.keys().next().value;
                    if (oldest !== undefined) this.persistentCache.delete(oldest);
                }
            }
        } catch (e: unknown) {
            Logger.warn("Cache", "Failed to load cache", e instanceof Error ? e : new Error(String(e)));
        }
    }

    private performNativeSave(): Promise<void> {
        this.savePromise = this.savePromise.then(async () => {
            if (!this.isDirty) return;
            this.isDirty = false; // Clear dirty flag BEFORE await

            try {
                const exportData = {
                    version: 2,
                    entries: Object.fromEntries(this.persistentCache)
                };
                await Native.batCacheSave(JSON.stringify(exportData));
            } catch (e: unknown) {
                this.isDirty = true; // Revert flag on error
                Logger.warn("Cache", "Failed to save cache", e instanceof Error ? e : new Error(String(e)));
            }
        });
        return this.savePromise;
    }

    private saveToStorage() {
        if (!this.isDirty) return;
        if (this.saveTimeout) return;

        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = null;
            this.performNativeSave();
        }, CACHE_SAVE_DEBOUNCE);
    }

    public async flush(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.performNativeSave();
    }

    getPending(key: string, source: string): Promise<string | null> | undefined {
        const entry = this.pending.get(key);
        if (entry && entry.source === source) {
            return entry.promise;
        }
        return undefined;
    }

    setPending(key: string, source: string, promise: Promise<string | null>) {
        this.pending.set(key, { source, promise });
        promise.finally(() => {
            if (this.pending.get(key)?.promise === promise) {
                this.pending.delete(key);
            }
        });
    }

    get(key: string): string | undefined {
        // Priority 1: Persistent Cache (Gemini)
        let val = this.persistentCache.get(key);
        if (val !== undefined) {
            // LRU re-insertion
            this.persistentCache.delete(key);
            this.persistentCache.set(key, val);
            return val;
        }

        // Priority 2: Volatile Cache (DeepL)
        val = this.volatileCache.get(key);
        if (val !== undefined) {
            this.volatileCache.delete(key);
            this.volatileCache.set(key, val);
            return val;
        }

        return undefined;
    }

    public peek(key: string): string | undefined {
        const val = this.persistentCache.get(key);
        if (val !== undefined) return val;
        return this.volatileCache.get(key);
    }

    public peekShared(targetLang: string, textHash: string): string | undefined {
        return this.sharedCache.get(`${targetLang}_${textHash}`);
    }

    set(key: string, translated: string, engine: string) {
        // Purge from both maps to avoid cross-map duplication
        this.persistentCache.delete(key);
        this.volatileCache.delete(key);

        const sharedKey = this.extractLangAndHash(key);
        if (sharedKey) {
            this.sharedCache.set(sharedKey, translated);
        }

        if (engine.startsWith("gemini") || engine.startsWith("deepseek")) {
            this.persistentCache.set(key, translated);

            while (this.persistentCache.size > CACHE_PERSISTENT_MAX_SIZE) {
                const oldest = this.persistentCache.keys().next().value;
                if (oldest !== undefined) {
                    this.persistentCache.delete(oldest);
                }
            }

            this.isDirty = true;
            this.saveToStorage();
        } else {
            this.volatileCache.set(key, translated);

            while (this.volatileCache.size > this.maxSize) {
                const oldest = this.volatileCache.keys().next().value;
                if (oldest !== undefined) {
                    this.volatileCache.delete(oldest);
                }
            }
        }
    }

    has(key: string): boolean {
        return this.persistentCache.has(key) || this.volatileCache.has(key);
    }

    clearVolatile() {
        this.volatileCache.clear();
    }

    public clearChannel(channelId: string) {
        let cId = channelId;
        try { cId = BigInt(channelId).toString(36); } catch {}
        const prefix = `c${cId}_`;
        let deleted = false;

        for (const key of this.persistentCache.keys()) {
            if (key.startsWith(prefix)) {
                this.persistentCache.delete(key);
                deleted = true;
            }
        }
        for (const key of this.volatileCache.keys()) {
            if (key.startsWith(prefix)) {
                this.volatileCache.delete(key);
            }
        }

        if (deleted) {
            this.isDirty = true;
            this.saveToStorage();
            this.cacheRevision++;
        }
    }

    public clearAll() {
        this.persistentCache.clear();
        this.volatileCache.clear();
        this.sharedCache.clear();
        this.outgoingCache.clear();
        this.isDirty = true;
        this.saveToStorage();
        this.cacheRevision++;
    }

    public getChannelCount(channelId: string): number {
        let cId = channelId;
        try { cId = BigInt(channelId).toString(36); } catch {}
        const prefix = `c${cId}_`;
        let count = 0;

        for (const key of this.persistentCache.keys()) {
            if (key.startsWith(prefix)) count++;
        }
        for (const key of this.volatileCache.keys()) {
            if (key.startsWith(prefix)) count++;
        }
        return count;
    }

    public getTotalCount(): number {
        return this.persistentCache.size + this.volatileCache.size;
    }

    get size(): number {
        return this.volatileCache.size + this.persistentCache.size;
    }
}
