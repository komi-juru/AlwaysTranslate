/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { CACHE_MAX_SIZE, CACHE_PERSISTENT_MAX_SIZE, CACHE_SAVE_DEBOUNCE } from "../constants";
import { getChannelCachePrefix } from "./hash";
import { Logger } from "./logger";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export class TranslationCache {
    private static instance: TranslationCache | null = null;

    private volatileCache = new Map<string, string>();
    private persistentCache = new Map<string, string>();
    private outgoingCache = new Map<string, string>();
    private initPromise: Promise<void> | null = null;
    private globalGeneration = 0;
    private channelGenerations = new Map<string, number>();
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

    public init(): Promise<void> {
        return this.initPromise ??= this.initialize();
    }

    private async initialize() {
        await this.loadFromStorage();
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleBeforeUnload = () => {
        if (this.isDirty) {
            this.performNativeSave();
        }
    };

    private async loadFromStorage() {
        try {
            const data = await Native.batCacheLoad();
            if (!data) return;
            const parsed = JSON.parse(data);
            // Older entries lack engine/model/dictionary metadata and cannot be reused safely.
            if (parsed?.version !== 3 || !parsed.entries || typeof parsed.entries !== "object") return;
            for (const [key, value] of Object.entries(parsed.entries)) {
                if (key.startsWith("v3:") && typeof value === "string") this.persistentCache.set(key, value);
            }
            while (this.persistentCache.size > CACHE_PERSISTENT_MAX_SIZE) {
                this.persistentCache.delete(this.persistentCache.keys().next().value!);
            }
        } catch (e) {
            Logger.warn("Cache", "Failed to load cache", e);
        }
    }

    public getGeneration(key: string): string {
        const channel = key.split(":")[1];
        return this.globalGeneration + ":" + (this.channelGenerations.get(channel) || 0);
    }

    public setOutgoing(channelId: string, text: string, original: string) {
        const key = getChannelCachePrefix(channelId) + text.trim();
        this.outgoingCache.delete(key);
        this.outgoingCache.set(key, original);
        while (this.outgoingCache.size > CACHE_MAX_SIZE) {
            this.outgoingCache.delete(this.outgoingCache.keys().next().value!);
        }
    }

    public getOutgoing(channelId: string, text: string): string | undefined {
        return this.outgoingCache.get(getChannelCachePrefix(channelId) + text.trim());
    }

    private performNativeSave(): Promise<void> {
        this.savePromise = this.savePromise.then(async () => {
            if (!this.isDirty) return;
            this.isDirty = false; // Clear dirty flag BEFORE await

            try {
                const exportData = {
                    version: 3,
                    entries: Object.fromEntries(this.persistentCache)
                };
                if (!await Native.batCacheSave(JSON.stringify(exportData))) throw new Error("Native cache save failed");
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
        const cleanup = () => {
            if (this.pending.get(key)?.promise === promise) {
                this.pending.delete(key);
            }
        };
        void promise.then(cleanup, cleanup);
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

    set(key: string, translated: string, engine: string) {
        // Purge from both maps to avoid cross-map duplication
        this.persistentCache.delete(key);
        this.volatileCache.delete(key);

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
        this.channelGenerations.set(channelId, (this.channelGenerations.get(channelId) || 0) + 1);
        this.cacheRevision++;
        const prefix = getChannelCachePrefix(channelId);
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

        for (const map of [this.pending, this.outgoingCache]) {
            for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
        }

        if (deleted) {
            this.isDirty = true;
            this.saveToStorage();
        }
    }

    public clearAll() {
        this.persistentCache.clear();
        this.volatileCache.clear();
        this.pending.clear();
        this.globalGeneration++;
        this.channelGenerations.clear();
        this.outgoingCache.clear();
        this.isDirty = true;
        this.saveToStorage();
        this.cacheRevision++;
    }

    public getChannelCount(channelId: string): number {
        const prefix = getChannelCachePrefix(channelId);
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
