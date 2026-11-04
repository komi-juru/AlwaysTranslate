import { Text as FormText } from "@components/Text";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */



import { GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import { settings } from "../settings";

export function SettingsOverview() {
    const { translationEngine = "gemini", manualTranslationEngine = "gemini", targetLang = "auto", channelList, deeplApiKey, geminiApiKey, deepseekApiKey } = settings.use([
        "translationEngine", "manualTranslationEngine", "targetLang", "channelList", "deeplApiKey", "geminiApiKey", "deepseekApiKey"
    ]);
    const engineLabel = (engine: string) => engine === "disable" ? "Off" : GLOBAL_ENGINE_OPTIONS.find(o => o.value === engine)?.label || engine;
    const resolvedLanguage = targetLang === "auto" ? document.documentElement.lang.split("-")[0] || "en" : targetLang;
    const language = LANGUAGES.find(l => l.value === resolvedLanguage)?.label || resolvedLanguage;
    const engines = new Set([translationEngine, manualTranslationEngine, ...channelList.map(c => c.engine || "default")]);
    const missing = [{ id: "gemini", label: "Gemini", key: geminiApiKey }, { id: "deepseek", label: "DeepSeek", key: deepseekApiKey }, { id: "deepl", label: "DeepL", key: deeplApiKey }]
        .filter(e => engines.has(e.id) && !e.key.trim()).map(e => e.label);
    return (
        <section style={{ marginBottom: 16 }} aria-label="Translation overview">
            <FormText>
                Auto: {engineLabel(translationEngine)} · Manual: {engineLabel(manualTranslationEngine)} · {language}
            </FormText>
            {missing.length > 0 && <FormText>Missing API key: {missing.join(", ")}</FormText>}
        </section>
    );
}
