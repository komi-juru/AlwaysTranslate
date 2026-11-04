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
    outgoingCustomPrompt?: string;
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
    header_translation: {
        type: OptionType.COMPONENT,
        component: (): ReactNode => null,
    },
    targetLang: {
        type: OptionType.SELECT,
        default: "auto",
        displayName: "My reading language",
        description: "Language for received messages.",
        options: LANGUAGES.map(l => l.value === "auto" ? { ...l, label: "Discord language", default: true } : l),
    },

    translationMode: {
        type: OptionType.SELECT,
        default: "global",
        displayName: "Automatic translation scope",
        description: "Channels to translate automatically.",
        options: [
            { label: "All channels", value: "global", default: true },
            { label: "Selected channels only", value: "whitelist" }
        ],
    },
    translationEngine: {
        type: OptionType.SELECT,
        default: "gemini",
        displayName: "Default translation engine",
        description: "Default engine. Channel overrides apply separately.",
        options: GLOBAL_ENGINE_OPTIONS.map(o => ({ ...o, label: o.value === "disable" ? "Off" : o.label, default: o.value === "gemini" })),
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
        default: "gemini-3.5-flash-lite",
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
        default: 1,
    },
    APIMaxBatchWait: {
        type: OptionType.CUSTOM,
        default: 0,
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
        description: "Translate before sending. Auto follows the latest message from another person.",
    },
    previewOutgoing: {
        type: OptionType.BOOLEAN,
        default: true,
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

export function normalizeTranslationEngines() {
    const supported = new Set(GLOBAL_ENGINE_OPTIONS.map(option => option.value));
    if (!supported.has(settings.store.translationEngine)) settings.store.translationEngine = "disable";
    for (const channel of settings.store.channelList) {
        if (channel.engine && channel.engine !== "default" && !supported.has(channel.engine)) {
            updateChannel(channel.id, { engine: "disable" });
        }
    }
}
