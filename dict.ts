/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { useEffect,useState } from "@webpack/common";

import { settings } from "./settings";
import { Logger } from "./utils/logger";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("./native")>;

export type DictMap = Record<string, string>;

export class CustomDictionaryStore {
    private static instance: CustomDictionaryStore | null = null;

    private dict: DictMap = {};
    private saveTimeout: NodeJS.Timeout | null = null;
    private listeners = new Set<() => void>();
    private isDirty = false;
    private initPromise: Promise<void> | null = null;
    private cacheSignature = "[]";
    private savePromise: Promise<void> = Promise.resolve();

    private constructor() {}

    public static getInstance(): CustomDictionaryStore {
        if (!this.instance) {
            this.instance = new CustomDictionaryStore();
        }
        return this.instance;
    }

    public init(): Promise<void> {
        return this.initPromise ??= this.initialize();
    }

    private async initialize() {
        await this.loadFromStorage();
        this.runMigration();
        this.notify();
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleBeforeUnload = () => { void this.flush(); };

    private async loadFromStorage() {
        try {
            const data = await Native.batDictLoad();
            if (data) {
                const parsed = JSON.parse(data);
                if (typeof parsed === "object" && !Array.isArray(parsed) && parsed !== null) {
                    this.dict = parsed;
                }
            }
        } catch (e: unknown) {
            Logger.warn("Dictionary", "Failed to load dictionary file", e instanceof Error ? e : new Error(String(e)));
        }
    }

    private runMigration() {
        const oldDict = settings.store.customDictionary;
        if (oldDict && Object.keys(oldDict).length > 0) {
            Logger.info("Dictionary", "Migrating dictionary from settings.json to standalone file...");
            for (const [key, value] of Object.entries(oldDict)) {
                if (!this.dict[key]) {
                    this.dict[key] = value as string;
                }
            }
            this.isDirty = true;
            this.saveToStorage();
        }
    }

    private saveToStorage() {
        if (!this.isDirty || this.saveTimeout) return;
        this.saveTimeout = setTimeout(() => {
            this.saveTimeout = null;
            void this.flush();
        }, 1000);
    }

    public flush(): Promise<void> {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        this.savePromise = this.savePromise.then(async () => {
            if (!this.isDirty) return;
            this.isDirty = false;
            try {
                if (!await Native.batDictSave(JSON.stringify(this.dict, null, 2))) throw new Error("Native dictionary save failed");
                // Only discard the old settings copy once the file is safely written.
                settings.store.customDictionary = {};
            } catch (e) {
                this.isDirty = true;
                Logger.warn("Dictionary", "Failed to save dictionary file", e);
            }
        });
        return this.savePromise;
    }

    public getCacheSignature(): string {
        return this.cacheSignature;
    }

    public subscribe(callback: () => void) {
        this.listeners.add(callback);
    }

    public unsubscribe(callback: () => void) {
        this.listeners.delete(callback);
    }

    private notify() {
        this.cacheSignature = JSON.stringify(Object.entries(this.dict).sort(([a], [b]) => a.localeCompare(b)));
        settings.store._cacheVersion = (settings.store._cacheVersion || 0) + 1;
        for (const listener of this.listeners) {
            listener();
        }
    }

    // --- Public API ---

    getDict(): DictMap {
        return { ...this.dict };
    }

    add(original: string, translated: string) {
        this.dict[original] = translated;
        this.isDirty = true;
        this.saveToStorage();
        this.notify();
    }

    remove(original: string) {
        if (this.dict[original] !== undefined) {
            delete this.dict[original];
            this.isDirty = true;
            this.saveToStorage();
            this.notify();
        }
    }
}

/**
 * React Hook to use the dictionary reactively.
 * Returns the current dictionary state and functions to modify it.
 */
export function useDictionary() {
    const dictStore = CustomDictionaryStore.getInstance();
    const [dict, setDict] = useState<DictMap>(dictStore.getDict());

    useEffect(() => {
        const handleUpdate = () => setDict(dictStore.getDict());
        dictStore.subscribe(handleUpdate);

        // Initial sync just in case
        handleUpdate();

        return () => dictStore.unsubscribe(handleUpdate);
    }, []);

    return {
        dict,
        add: (original: string, translated: string) => dictStore.add(original, translated),
        remove: (original: string) => dictStore.remove(original)
    };
}
