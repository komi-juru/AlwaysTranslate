/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "./constants";


export interface ChannelConfig {
    id: string;
    lang: string;
    engine?: string;
    aiCustomPrompt?: string;
}

export type GeminiQuotaKind = "rpm" | "tpm" | "rpd";

export interface GeminiQuotaLockState {
    rpmUntil?: number;
    tpmUntil?: number;
    rpdUntil?: number;
}

export const settings = definePluginSettings({
    ui_githubLink: {
        type: OptionType.COMPONENT,
        name: "GitHub Link",
        component: () => null,
    },
    header_translation: {
        type: OptionType.COMPONENT,
        component: () => null,
    },
    targetLang: {
        type: OptionType.SELECT,
        default: "auto",
        name: "Target Language",
        description: "Translate everything to this language.",
        options: [...LANGUAGES],
    },
    enableTranslation: {
        type: OptionType.BOOLEAN,
        default: true,
        name: "Enable AlwaysTranslate",
        description: "Turn translator on/off.",
    },
    translationMode: {
        type: OptionType.SELECT,
        default: "global",
        name: "Translation Mode",
        description: "Translate everywhere, or only in selected channels.",
        options: [
            { label: "🌐 Global (Translate All)", value: "global" },
            { label: "🎯 Whitelist (Selected Only)", value: "whitelist" }
        ],
    },
    translationEngine: {
        type: OptionType.SELECT,
        default: "gemini",
        name: "Default Translation Engine",
        description: "Default engine for new channels.",
        options: [...GLOBAL_ENGINE_OPTIONS],
    },
    manualTranslationEngine: {
        type: OptionType.SELECT,
        default: "gemini",
        name: "Manual Translation Engine",
        description: "Engine for the manual translate button.",
        options: [
            { label: "Disable", value: "disable" },
            ...GLOBAL_ENGINE_OPTIONS
        ],
    },
    deeplApiKey: {
        type: OptionType.CUSTOM,
        default: "",
    },
    ui_apiKeys: {
        type: OptionType.COMPONENT,
        name: "API Keys",
        component: () => null,
    },

    geminiApiKey: {
        type: OptionType.CUSTOM,
        default: "",
    },
    geminiModel: {
        type: OptionType.CUSTOM,
        default: "gemini-3.1-flash-lite",
    },
    deepseekApiKey: {
        type: OptionType.CUSTOM,
        default: "",
    },
    deepseekBaseUrl: {
        type: OptionType.CUSTOM,
        default: "https://api.deepseek.com/chat/completions",
    },
    deepseekModel: {
        type: OptionType.CUSTOM,
        default: "deepseek-v4-flash",
    },
    geminiQuotaLocks: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, GeminiQuotaLockState>,
    },
    APIEcoModeThreshold: {
        type: OptionType.SLIDER,
        name: "API Eco Mode Threshold",
        description: "Wait for N messages to batch translate. (Set to 3 for normal use)",
        markers: [1, 3, 5, 10, 25, 50, 100, 250],
        default: 3,
        componentProps: { equidistant: true },
    },
    APIMaxBatchWait: {
        type: OptionType.SLIDER,
        name: "API Max Batch Wait Time (sec)",
        description: "Max wait time before forcing translation. (0 = infinite)",
        markers: [0, 5, 10, 15, 30, 60, 120, 180, 300],
        default: 10,
        componentProps: { equidistant: true },
    },

    header_management: {
        type: OptionType.COMPONENT,
        component: () => null,
    },
    channelList: {
        type: OptionType.CUSTOM,
        default: [] as ChannelConfig[],
    },
    channelManager: {
        type: OptionType.COMPONENT,
        // Assigned dynamically in index.tsx to avoid circular imports
        component: () => null,
    },
    translateOutgoing: {
        type: OptionType.BOOLEAN,
        default: false,
        name: "Translate Outgoing Messages",
        description: "Auto-translate your own messages.",
    },
    skipOwnMessages: {
        type: OptionType.BOOLEAN,
        default: true,
        name: "Skip Self Messages",
        description: "Don't translate your own messages.",
    },

    ignorePrefix: {
        type: OptionType.STRING,
        default: "!",
        name: "Ignore Prefix",
        description: "Skip messages starting with this.",
    },

    header_dictionary: {
        type: OptionType.COMPONENT,
        component: () => null,
    },
    customDictionary: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>,
    },
    dictionaryCaseSensitive: {
        type: OptionType.BOOLEAN,
        default: false,
        name: "Case Sensitive (English)",
        description: "Match uppercase/lowercase exactly.",
    },
    dictionaryManager: {
        type: OptionType.COMPONENT,
        component: () => null,
    },

    header_design: {
        type: OptionType.COMPONENT,
        component: () => null,
    },

    showSeparator: {
        type: OptionType.BOOLEAN,
        default: true,
        name: "Show Separator Line",
        description: "Show line above translations.",
    },
    hideOriginal: {
        type: OptionType.BOOLEAN,
        default: false,
        name: "Hide Original Message",
        description: "Hide original text.",
    },
    preserveEmojis: {
        type: OptionType.BOOLEAN,
        default: true,
        name: "Preserve Emojis & Mentions",
        description: "Keep emojis and tags.",
    },
    translationColor: {
        type: OptionType.CUSTOM,
        default: "",
    },
    ui_translationColor: {
        type: OptionType.COMPONENT,
        component: () => null,
    },
    ui_clearCache: {
        type: OptionType.COMPONENT,
        component: () => null,
    },
});

// ─── Helper functions ───

/**
 * Get translation config for a specific channel.
 * Returns { allowed, config } where `allowed` means translation should run.
 */
export function getChannelConfig(channelId: string): {
    allowed: boolean;
    config: ChannelConfig | null;
} {
    if (!settings.store.enableTranslation) {
        return { allowed: false, config: null };
    }

    const channels = settings.store.channelList;
    const config = channels.find(c => c.id === channelId);

    if (settings.store.translationMode === "global") {
        return { allowed: true, config: config ?? null };
    } else {
        return { allowed: !!config, config: config ?? null };
    }
}

/**
 * Immutably update a single channel's properties.
 */
export function updateChannel(
    channelId: string,
    updater: Partial<Omit<ChannelConfig, "id">>
) {
    const channel = settings.store.channelList.find(ch => ch.id === channelId);
    if (channel) {
        Object.assign(channel, updater);
    }
}

/**
 * Immutably add a channel to the list.
 */
export function addChannel(id: string, lang = "auto") {
    const channels = settings.store.channelList;
    if (channels.some(c => c.id === id)) return;
    channels.push({ id, lang });
}

/**
 * Immutably remove a channel from the list.
 */
export function removeChannel(id: string) {
    const channels = settings.store.channelList;
    const index = channels.findIndex(c => c.id === id);
    if (index !== -1) {
        channels.splice(index, 1);
    }
}
