/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const CONCURRENCY_LIMIT = 3;
export const CACHE_MAX_SIZE = 1000;
export const CACHE_PERSISTENT_MAX_SIZE = 50000;
export const CACHE_SAVE_DEBOUNCE = 5000; // ms
export const QUEUE_TTL = 10000; // ms
export const GEMINI_BATCH_SIZE = 1000;
export const DEEPL_BATCH_SIZE = 50;
export const GEMINI_TEMPERATURE = 0.3;
export const BATCH_ACCUMULATION_TIME_GEMINI = 200; // ms – debounce interval per new message
export const BATCH_MAX_WAIT_GEMINI = 12000; // ms – maximum wait time from the first message
export const GEMINI_RPM_LIMIT = 10; // max Gemini requests per rolling 60-second window
export const BATCH_ACCUMULATION_TIME_DEEPL = 50; // ms

export const LANGUAGES = [
    { label: "Auto Detect", value: "auto" },
    { label: "Arabic", value: "ar" },
    { label: "Bulgarian", value: "bg" },
    { label: "Chinese (Simplified)", value: "zh-CN" },
    { label: "Chinese (Traditional, Taiwan)", value: "zh-TW" },
    { label: "Czech", value: "cs" },
    { label: "Danish", value: "da" },
    { label: "Dutch", value: "nl" },
    { label: "English", value: "en" },
    { label: "Finnish", value: "fi" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Greek", value: "el" },
    { label: "Hungarian", value: "hu" },
    { label: "Indonesian", value: "id" },
    { label: "Italian", value: "it" },
    { label: "Japanese", value: "ja" },
    { label: "Korean", value: "ko" },
    { label: "Lithuanian", value: "lt" },
    { label: "Norwegian", value: "no" },
    { label: "Polish", value: "pl" },
    { label: "Portuguese", value: "pt" },
    { label: "Romanian", value: "ro" },
    { label: "Russian", value: "ru" },
    { label: "Spanish", value: "es" },
    { label: "Swedish", value: "sv" },
    { label: "Turkish", value: "tr" },
    { label: "Ukrainian", value: "uk" },
] as const;

export type LangCode = typeof LANGUAGES[number]["value"];

export const GLOBAL_ENGINE_OPTIONS = [
    { label: "Disable", value: "disable" },
    { label: "Gemini", value: "gemini" },
    { label: "DeepSeek", value: "deepseek" },
    { label: "DeepL", value: "deepl" },
];

export const CHANNEL_ENGINE_OPTIONS = [
    { label: "Disable", value: "disable" },
    { label: "Default", value: "default" },
    ...GLOBAL_ENGINE_OPTIONS.filter(o => o.value !== "disable")
];
