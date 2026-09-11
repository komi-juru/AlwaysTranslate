/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import { settings } from "../settings";

export function SettingsOverview() {
    const { translationEngine = "gemini", manualTranslationEngine = "gemini", targetLang = "auto", translationMode = "global", channelList, translateOutgoing, deeplApiKey, geminiApiKey, deepseekApiKey } = settings.use([
        "translationEngine", "manualTranslationEngine", "targetLang", "translationMode", "channelList", "translateOutgoing", "deeplApiKey", "geminiApiKey", "deepseekApiKey"
    ]);
    const engineLabel = (engine: string) => engine === "disable" ? "Off" : GLOBAL_ENGINE_OPTIONS.find(o => o.value === engine)?.label || engine;
    const resolvedLanguage = targetLang === "auto" ? document.documentElement.lang.split("-")[0] || "en" : targetLang;
    const language = LANGUAGES.find(l => l.value === resolvedLanguage)?.label || resolvedLanguage;
    const exceptions = channelList.filter(c => c.engine && c.engine !== "default" && c.engine !== translationEngine).length;
    const engines = new Set([translationEngine, manualTranslationEngine, ...channelList.map(c => c.engine || "default")]);
    const missing = [{ id: "gemini", label: "Gemini", key: geminiApiKey }, { id: "deepseek", label: "DeepSeek", key: deepseekApiKey }, { id: "deepl", label: "DeepL", key: deeplApiKey }]
        .filter(e => engines.has(e.id) && !e.key.trim()).map(e => e.label);
    return (
        <section className="bat-settings-overview" aria-label="Translation overview">
            <div className="bat-settings-eyebrow">ALWAYSTRANSLATE</div>
            <h2>Your translation setup</h2>
            <p className="bat-settings-description">Automatic and manual translation have separate engine settings.</p>
            <dl className="bat-settings-grid">
                <div><dt>Default auto engine</dt><dd>{engineLabel(translationEngine)}</dd></div>
                <div><dt>Manual button</dt><dd>{engineLabel(manualTranslationEngine)}</dd></div>
                <div><dt>Translate incoming into</dt><dd>{language}{targetLang === "auto" ? " · Discord language" : ""}</dd></div>
                <div><dt>Automatic translation scope</dt><dd>{translationMode === "global" ? "All channels" : `${channelList.length} selected channels`}</dd></div>
            </dl>
            <p className="bat-settings-description">
                Outgoing translation: {translateOutgoing ? "On" : "Off"}.
                {exceptions > 0 && ` ${exceptions} channel-specific engine override${exceptions === 1 ? "" : "s"}.`}
                {translationEngine === "disable" && " Default automatic translation is off; channel overrides and the manual button may still translate."}
                {translationMode === "whitelist" && channelList.length === 0 && " Add a channel below to enable automatic translation there."}
            </p>
            {missing.length > 0 && <p className="bat-settings-notice">Add API keys for {missing.join(", ")} in API connections below. A saved key still needs to be tested.</p>}
        </section>
    );
}
