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

    private constructor() {}

    public static getInstance(): CustomDictionaryStore {
        if (!this.instance) {
            this.instance = new CustomDictionaryStore();
        }
        return this.instance;
    }

    public async init() {
        await this.loadFromStorage();
        this.runMigration();
        this.notify();
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleBeforeUnload = () => {
        if (this.isDirty) {
            // We can't await in beforeunload, but we trigger the IPC call
            Native.batDictSave(JSON.stringify(this.dict, null, 2));
            this.isDirty = false;
        }
    };

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
            settings.store.customDictionary = {};
            this.isDirty = true;
            this.saveToStorage();
        }
    }

    private saveToStorage() {
        if (!this.isDirty) return;
        if (this.saveTimeout) return;
        this.saveTimeout = setTimeout(async () => {
            try {
                if (!this.isDirty) return;

                // Clear dirty flag BEFORE await to avoid swallowing changes that occur during save
                this.isDirty = false;

                const data = JSON.stringify(this.dict, null, 2);
                await Native.batDictSave(data);
            } catch (e: unknown) {
                this.isDirty = true; // Revert flag on error
                Logger.warn("Dictionary", "Failed to save dictionary file", e instanceof Error ? e : new Error(String(e)));
            } finally {
                this.saveTimeout = null;
            }
        }, 1000); // 1 second debounce
    }

    public subscribe(callback: () => void) {
        this.listeners.add(callback);
    }

    public unsubscribe(callback: () => void) {
        this.listeners.delete(callback);
    }

    private notify() {
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
