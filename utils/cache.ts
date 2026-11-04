/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { CACHE_MAX_SIZE, CACHE_PERSISTENT_MAX_SIZE, CACHE_SAVE_DEBOUNCE } from "../constants";
import { CACHE_BYTE_BUDGET, CACHE_ENTRY_BYTE_LIMIT, CACHE_PATCH_BYTE_LIMIT, CACHE_PATCH_ENTRY_LIMIT, cacheEntryBytes, type CachePatch, DISPLAY_CACHE_BYTE_BUDGET, OUTGOING_CACHE_BYTE_BUDGET } from "./cachePolicy";
import { getChannelCachePrefix } from "./hash";
import { Logger } from "./logger";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;
type Entry = { value: string; bytes: number };

export class TranslationCache {
    private static instance: TranslationCache | null = null;
    private persistentCache = new Map<string, Entry>();
    private persistentBytes = 0;
    private outgoingCache = new Map<string, Entry>();
    private outgoingBytes = 0;
    private displayed = new Map<string, { cacheKey: string; source: string; bytes: number }>();
    private displayedBytes = 0;
    private changes = new Map<string, string | null>();
    private nativeKeys = new Set<string>();
    private inFlightKeys = new Set<string>();
    private clearPending = false;
    private initPromise: Promise<void> | null = null;
    private globalGeneration = 0;
    private channelGenerations = new Map<string, Set<{ valid: boolean }>>();
    public cacheRevision = 0;
    private pending = new Map<string, { source: string; promise: Promise<string | null> }>();
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;
    private savePromise: Promise<void> = Promise.resolve();
    private saveFailures = 0;
    private constructor() {}

    public static getInstance(): TranslationCache {
        return this.instance ??= new TranslationCache();
    }

    public init(): Promise<void> {
        return this.initPromise ??= this.initialize();
    }

    private async initialize() {
        try {
            const data = await Native.batCacheLoad();
            const parsed = data ? JSON.parse(data) : null;
            if (parsed?.version === 3 && parsed.entries && typeof parsed.entries === "object") {
                for (const [key, value] of Object.entries(parsed.entries)) {
                    if (!key.startsWith("v3:") || typeof value !== "string") continue;
                    this.nativeKeys.add(key);
                    const bytes = cacheEntryBytes(key, value);
                    if (bytes > CACHE_ENTRY_BYTE_LIMIT) { this.changes.set(key, null); continue; }
                    this.persistentCache.set(key, { value, bytes });
                    this.persistentBytes += bytes;
                    this.trim();
                }
            }
        } catch (error) { Logger.warn("Cache", "Failed to load cache", error); }
        window.addEventListener("beforeunload", this.handleBeforeUnload);
        this.saveToStorage();
    }

    private handleBeforeUnload = () => { void this.performNativeSave(); };

    public watchGeneration(key: string) {
        const channel = key.split(":")[1];
        const generation = this.globalGeneration;
        const token = { valid: true };
        let watchers = this.channelGenerations.get(channel);
        if (!watchers) this.channelGenerations.set(channel, watchers = new Set());
        watchers.add(token);
        return {
            isCurrent: () => token.valid && generation === this.globalGeneration,
            release: () => {
                watchers.delete(token);
                if (!watchers.size && this.channelGenerations.get(channel) === watchers) this.channelGenerations.delete(channel);
            }
        };
    }

    private remove(key: string) {
        const entry = this.persistentCache.get(key);
        if (entry) this.persistentBytes -= entry.bytes;
        this.persistentCache.delete(key);
        if (this.nativeKeys.has(key) || this.inFlightKeys.has(key)) this.changes.set(key, null);
        else this.changes.delete(key);
    }

    private trim() {
        while (this.persistentCache.size > CACHE_PERSISTENT_MAX_SIZE || this.persistentBytes > CACHE_BYTE_BUDGET) {
            this.remove(this.persistentCache.keys().next().value!);
        }
    }

    public setOutgoing(channelId: string, text: string, original: string) {
        const key = getChannelCachePrefix(channelId) + text.trim();
        this.outgoingBytes -= this.outgoingCache.get(key)?.bytes ?? 0;
        this.outgoingCache.delete(key);
        const bytes = cacheEntryBytes(key, original);
        if (bytes <= CACHE_ENTRY_BYTE_LIMIT) {
            this.outgoingCache.set(key, { value: original, bytes }); this.outgoingBytes += bytes;
        }
        while (this.outgoingCache.size > CACHE_MAX_SIZE || this.outgoingBytes > OUTGOING_CACHE_BYTE_BUDGET) {
            const oldest = this.outgoingCache.keys().next().value!;
            this.outgoingBytes -= this.outgoingCache.get(oldest)!.bytes; this.outgoingCache.delete(oldest);
        }
    }

    public getOutgoing(channelId: string, text: string): string | undefined {
        const key = getChannelCachePrefix(channelId) + text.trim(), entry = this.outgoingCache.get(key);
        if (entry) { this.outgoingCache.delete(key); this.outgoingCache.set(key, entry); }
        return entry?.value;
    }

    public getDisplayed(channelId: string, messageId: string, source: string, target: string): { cacheKey: string; text: string } | undefined {
        const key = JSON.stringify([channelId, messageId, target]);
        const entry = this.displayed.get(key);
        if (!entry) return;
        const text = this.peek(entry.cacheKey);
        if (entry.source !== source || !text) {
            this.displayedBytes -= entry.bytes;
            this.displayed.delete(key);
            return;
        }
        return { cacheKey: entry.cacheKey, text };
    }

    public rememberDisplayed(channelId: string, messageId: string, source: string, target: string, cacheKey: string) {
        if (!this.has(cacheKey)) return;
        const key = JSON.stringify([channelId, messageId, target]);
        this.displayedBytes -= this.displayed.get(key)?.bytes ?? 0;
        this.displayed.delete(key);
        const bytes = cacheEntryBytes(key, source) + cacheEntryBytes(cacheKey, "");
        if (bytes <= DISPLAY_CACHE_BYTE_BUDGET) {
            this.displayed.set(key, { cacheKey, source, bytes });
            this.displayedBytes += bytes;
        }
        while (this.displayed.size > CACHE_MAX_SIZE || this.displayedBytes > DISPLAY_CACHE_BYTE_BUDGET) {
            const oldest = this.displayed.keys().next().value!;
            this.displayedBytes -= this.displayed.get(oldest)!.bytes;
            this.displayed.delete(oldest);
        }
    }

    private performNativeSave(): Promise<void> {
        this.savePromise = this.savePromise.then(async () => {
            while (this.clearPending || this.changes.size) {
                const generation = this.globalGeneration;
                const patch: CachePatch = { version: 3, clear: this.clearPending, entries: [], persist: false };
                let bytes = 0;
                for (const [key, value] of this.changes) {
                    const size = cacheEntryBytes(key, value ?? "");
                    if (patch.entries.length && (bytes + size > CACHE_PATCH_BYTE_LIMIT || patch.entries.length >= CACHE_PATCH_ENTRY_LIMIT)) break;
                    patch.entries.push([key, value]); bytes += size;
                }
                for (const [key] of patch.entries) { this.changes.delete(key); this.inFlightKeys.add(key); }
                this.clearPending = false;
                patch.persist = this.changes.size === 0;
                try {
                    if (!await Native.batCacheSave(patch)) throw new Error("Native cache save failed");
                    if (patch.persist) this.saveFailures = 0;
                    if (generation === this.globalGeneration) {
                        if (patch.clear) this.nativeKeys.clear();
                        for (const [key, value] of patch.entries) {
                            if (value === null) this.nativeKeys.delete(key); else this.nativeKeys.add(key);
                        }
                    }
                } catch (error) {
                    if (generation === this.globalGeneration) {
                        this.clearPending ||= patch.clear;
                        for (const [key, value] of patch.entries) {
                            // The native process may have applied the patch before its disk write failed.
                            if (value !== null) this.nativeKeys.add(key);
                            if (!this.changes.has(key)) this.changes.set(key, value);
                        }
                    }
                    Logger.warn("Cache", "Failed to save cache", error);
                    this.saveFailures++;
                    this.saveToStorage(Math.min(60000, CACHE_SAVE_DEBOUNCE * 2 ** Math.min(this.saveFailures - 1, 4)));
                    return;
                } finally { this.inFlightKeys.clear(); }
            }
            if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
        });
        return this.savePromise;
    }

    private saveToStorage(delay = CACHE_SAVE_DEBOUNCE) {
        if ((!this.clearPending && !this.changes.size) || this.saveTimeout) return;
        this.saveTimeout = setTimeout(() => { this.saveTimeout = null; void this.performNativeSave(); }, delay);
    }

    public async flush(): Promise<void> {
        if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
        await this.performNativeSave();
    }

    getPending(key: string, source: string): Promise<string | null> | undefined {
        const entry = this.pending.get(key);
        return entry?.source === source ? entry.promise : undefined;
    }

    setPending(key: string, source: string, promise: Promise<string | null>) {
        this.pending.set(key, { source, promise });
        const cleanup = () => { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); };
        void promise.then(cleanup, cleanup);
    }

    get(key: string): string | undefined {
        const entry = this.persistentCache.get(key);
        if (entry) { this.persistentCache.delete(key); this.persistentCache.set(key, entry); }
        return entry?.value;
    }

    public peek(key: string): string | undefined { return this.persistentCache.get(key)?.value; }

    set(key: string, translated: string, engine: string) {
        if (!engine.startsWith("gemini") && !engine.startsWith("deepseek")) return;
        if (this.peek(key) === translated) { this.get(key); return; }
        this.remove(key);
        const bytes = cacheEntryBytes(key, translated);
        if (bytes <= CACHE_ENTRY_BYTE_LIMIT) {
            this.persistentCache.set(key, { value: translated, bytes }); this.persistentBytes += bytes;
            this.changes.set(key, translated); this.trim();
        }
        this.saveToStorage();
    }

    has(key: string): boolean { return this.persistentCache.has(key); }

    public clearChannel(channelId: string) {
        this.channelGenerations.get(channelId)?.forEach(token => { token.valid = false; });
        this.channelGenerations.delete(channelId); this.cacheRevision++;
        const prefix = getChannelCachePrefix(channelId);
        for (const key of this.persistentCache.keys()) if (key.startsWith(prefix)) this.remove(key);
        for (const key of this.outgoingCache.keys()) if (key.startsWith(prefix)) {
            this.outgoingBytes -= this.outgoingCache.get(key)!.bytes; this.outgoingCache.delete(key);
        }
        for (const [key, entry] of this.displayed) if (entry.cacheKey.startsWith(prefix)) {
            this.displayedBytes -= entry.bytes; this.displayed.delete(key);
        }
        for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
        this.saveToStorage();
    }

    public clearAll() {
        this.persistentCache.clear(); this.persistentBytes = 0;
        this.outgoingCache.clear(); this.outgoingBytes = 0;
        this.displayed.clear(); this.displayedBytes = 0;
        this.pending.clear(); this.nativeKeys.clear(); this.changes.clear(); this.clearPending = true;
        this.globalGeneration++; this.channelGenerations.clear(); this.cacheRevision++;
        this.saveToStorage();
    }

    public getChannelCount(channelId: string): number {
        const prefix = getChannelCachePrefix(channelId);
        let count = 0;
        for (const key of this.persistentCache.keys()) if (key.startsWith(prefix)) count++;
        return count;
    }
    public getTotalCount(): number { return this.persistentCache.size; }
    get size(): number { return this.persistentCache.size; }
}
