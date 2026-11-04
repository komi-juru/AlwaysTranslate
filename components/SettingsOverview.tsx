/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Text as FormText } from "@components/Text";

import { GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import { settings } from "../settings";

export const SettingsOverview = ErrorBoundary.wrap(function SettingsOverview() {
    const { translationEngine = "gemini", targetLang = "auto", channelList, geminiApiKey, deepseekApiKey } = settings.use([
        "translationEngine", "targetLang", "channelList", "geminiApiKey", "deepseekApiKey"
    ]);
    const engineLabel = (engine: string) => engine === "disable" ? "Off" : GLOBAL_ENGINE_OPTIONS.find(o => o.value === engine)?.label || engine;
    const resolvedLanguage = targetLang === "auto" ? document.documentElement.lang.split("-")[0] || "en" : targetLang;
    const language = LANGUAGES.find(l => l.value === resolvedLanguage)?.label || resolvedLanguage;
    const engines = new Set([translationEngine, ...channelList.map(c => c.engine || "default")]);
    const missing = [{ id: "gemini", label: "Gemini", key: geminiApiKey }, { id: "deepseek", label: "DeepSeek", key: deepseekApiKey }]
        .filter(e => engines.has(e.id) && !e.key.trim()).map(e => e.label);
    return (
        <section style={{ marginBottom: 16 }} aria-label="Translation overview">
            <FormText>
                Auto: {engineLabel(translationEngine)} · {language}
            </FormText>
            {missing.length > 0 && <FormText>Missing API key: {missing.join(", ")}</FormText>}
        </section>
    );
}, { noop: true });
