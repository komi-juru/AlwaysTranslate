/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import type { ReactNode } from "react";

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
        component: (): ReactNode => null,
    },
    ui_overview: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    header_translation: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    targetLang: {
        type: OptionType.SELECT,
        default: "auto",
        displayName: "My reading language",
        description: "Incoming messages are translated into this language. Discord language follows your client language.",
        options: LANGUAGES.map(l => l.value === "auto" ? { ...l, label: "Discord language", default: true } : l),
    },

    translationMode: {
        type: OptionType.SELECT,
        default: "global",
        displayName: "Automatic translation scope",
        description: "Choose where automatic translation runs. Set channel-specific languages and engines below.",
        options: [
            { label: "All channels", value: "global", default: true },
            { label: "Selected channels only", value: "whitelist" }
        ],
    },
    translationEngine: {
        type: OptionType.SELECT,
        default: "gemini",
        displayName: "Default automatic engine",
        description: "Off disables default automatic translation. Channel overrides and the manual button can still translate.",
        options: GLOBAL_ENGINE_OPTIONS.map(o => ({ ...o, label: o.value === "disable" ? "Off" : o.label, default: o.value === "gemini" })),
    },
    manualTranslationEngine: {
        type: OptionType.SELECT,
        default: "gemini",
        displayName: "Manual button engine",
        description: "Engine used by Translate Now in the chat bar. This works independently of the default automatic engine.",
        options: GLOBAL_ENGINE_OPTIONS.map(o => ({ ...o, label: o.value === "disable" ? "Off" : o.label, default: o.value === "gemini" })),
    },
    deeplApiKey: {
        type: OptionType.CUSTOM,
        default: "",
    },
    ui_apiKeys: {
        type: OptionType.COMPONENT,
        name: "API Keys",
        component: (): ReactNode => null,
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
    ui_presets: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    APIEcoModeThreshold: {
        type: OptionType.CUSTOM,
        default: 3,
    },
    APIMaxBatchWait: {
        type: OptionType.CUSTOM,
        default: 10,
    },

    header_management: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    channelList: {
        type: OptionType.CUSTOM,
        default: [] as ChannelConfig[],
    },
    channelManager: {
        type: OptionType.COMPONENT,
        // Assigned dynamically in index.tsx to avoid circular imports
        component: (): ReactNode => null,
    },
    translateOutgoing: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Translate outgoing messages",
        description: "Translate before sending. Set the other person's language in channel settings. Auto does not detect their language for outgoing messages.",
    },
    previewOutgoing: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Preview before sending",
        description: "Show translated text in chatbox before sending.",
    },
    skipOwnMessages: {
        type: OptionType.BOOLEAN,
        default: true,
        displayName: "Skip my incoming messages",
        description: "Don't translate your own messages.",
    },

    ignorePrefix: {
        type: OptionType.STRING,
        default: "!",
        displayName: "Skip translation prefix",
        description: "Skip messages starting with this.",
    },

    header_dictionary: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    customDictionary: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string>,
    },
    dictionaryCaseSensitive: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Case-sensitive dictionary (English)",
        description: "Match uppercase/lowercase exactly.",
    },
    dictionaryManager: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },

    header_design: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },

    showSeparator: {
        type: OptionType.BOOLEAN,
        default: true,
        displayName: "Show separator line",
        description: "Show line above translations.",
    },
    hideOriginal: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Hide original message",
        description: "Hide original text.",
    },
    hideEmojis: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Hide emojis",
        description: "Completely remove emojis from translation.",
    },
    hideMentions: {
        type: OptionType.BOOLEAN,
        default: false,
        displayName: "Hide mentions",
        description: "Completely remove @usernames from translation.",
    },
    translationColor: {
        type: OptionType.CUSTOM,
        default: "",
    },
    ui_translationColor: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    _cacheVersion: {
        type: OptionType.CUSTOM,
        default: 0,
    },
    ui_clearCache: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
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
    const channels = settings.store.channelList;
    const channelIndex = channels.findIndex(ch => ch.id === channelId);
    if (channelIndex !== -1) {
        channels[channelIndex] = { ...channels[channelIndex], ...updater };
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
