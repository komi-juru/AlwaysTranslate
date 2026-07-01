/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import definePlugin from "@utils/types";
import { Forms } from "@webpack/common";

import { resetTranslationQueues,safeTranslate } from "./api/translate";
import { ApiKeysManager } from "./components/ApiKeyInput";
import { ChannelManager } from "./components/ChannelManager";
import { ClearCacheButton } from "./components/ClearCacheButton";
import { ColorPickerInput } from "./components/ColorPickerInput";
import { DictionaryManager } from "./components/DictionaryManager";
import { GithubLinkInjector } from "./components/GithubLinkInjector";
import { ManualBatchChatBarIcon, TranslateHeaderButton } from "./components/HeaderBarIcon";
import { SettingsPresets } from "./components/SettingsPresets";
import { TranslationAccessory } from "./components/TranslationAccessory";
import { CustomDictionaryStore } from "./dict";
import { getChannelConfig, settings } from "./settings";
import { TranslationCache } from "./utils/cache";


const SettingsHeader = ({ title }: { title: string }) => (
    <div style={{ marginTop: "24px", marginBottom: "8px", borderBottom: "1px solid var(--background-modifier-accent)", paddingBottom: "4px" }}>
        <Forms.FormTitle tag="h2" style={{ margin: 0, fontSize: "16px", color: "var(--header-primary)" }}>{title}</Forms.FormTitle>
    </div>
);

// Wire up dynamic COMPONENT settings (avoids circular imports)
settings.def.ui_githubLink.component = GithubLinkInjector;
settings.def.header_translation.component = () => <SettingsHeader title="⚙️ Translation Setup" />;
settings.def.header_dictionary.component = () => <SettingsHeader title="📖 Custom Dictionary" />;
settings.def.dictionaryManager.component = DictionaryManager;
settings.def.header_management.component = () => <SettingsHeader title="🛡️ Chat Whitelist Management" />;
settings.def.header_design.component = () => <SettingsHeader title="🎨 UI & Design" />;
settings.def.channelManager.component = ChannelManager;
settings.def.ui_apiKeys.component = ApiKeysManager;


settings.def.ui_translationColor.component = ColorPickerInput;
settings.def.ui_clearCache.component = ClearCacheButton;
settings.def.ui_presets.component = SettingsPresets;

export let pluginStarted = false;

let translatingActiveCount = 0;

export default definePlugin({
    name: "AlwaysTranslate",
    description: "Real-time AI translation.",
    authors: [{ name: "komi-juru", id: 682762388143210549n }],
    github: "https://github.com/komi-juru/AlwaysTranslate",
    settings,

    // 🔄 Lifecycle 🔄

    start() {
        pluginStarted = true;
        resetTranslationQueues();
        CustomDictionaryStore.getInstance().init();
        TranslationCache.getInstance().init();
        addMessageAccessory("AlwaysTranslate", props => <TranslationAccessory message={props.message} />, 0);
    },

    chatBarButton: {
        render: ManualBatchChatBarIcon
    },

    stop() {
        pluginStarted = false;
        TranslationCache.getInstance().flush();
        resetTranslationQueues();
        removeMessageAccessory("AlwaysTranslate");

        // Restore any hidden original messages
        document.querySelectorAll('[id^="message-content-"]').forEach(el => {
            (el as HTMLElement).style.display = "";
        });

        // Force remove leftover translation UIs
        document.querySelectorAll(".bat-translation").forEach(el => el.remove());
    },

    // 🛠️ Header Bar Patch 🛠️

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.TrailingWrapper,",
            },
        },
    ],

    TrailingWrapper({ children }: any) {
        return (
            <>
                <TranslateHeaderButton />
                {children}
            </>
        );
    },

    // 📤 Outgoing Message Translation 📤

    async onBeforeMessageSend(channelId: string, message: any) {
        if (!settings.store.translateOutgoing) return;
        if (!message.content) return;

        const { allowed, config } = getChannelConfig(channelId);
        if (!allowed) return;

        const { ignorePrefix } = settings.store;
        if (ignorePrefix && message.content.startsWith(ignorePrefix)) {
            message.content = message.content.slice(ignorePrefix.length);
            return;
        }

        const { translationEngine, deeplApiKey, geminiApiKey, deepseekApiKey } = settings.store;
        let { targetLang } = settings.store;

        // Use per-channel language if configured
        if (config?.lang && config.lang !== "auto") {
            targetLang = config.lang;
        }

        if (targetLang === "auto") {
            targetLang = document.documentElement.lang.split("-")[0] || "en";
        }

        // Logical Error Prevention:
        // If the final target language for this outgoing message is the user's own client language,
        // it means we are trying to translate from Native -> Native (e.g. Korean -> Korean).
        // This happens if the channel's language is "auto" and we don't know the foreigner's language.
        const clientLang = document.documentElement.lang.split("-")[0] || "en";
        if (targetLang === clientLang) {
            return;
        }

        let currentEngine = config?.engine ?? translationEngine;
        if (currentEngine === "default") currentEngine = translationEngine;




        translatingActiveCount++;
        if (translatingActiveCount === 1) {
            document.body.classList.add("bat-translating-active");
        }

        try {
            const result = await safeTranslate(
                message.content,
                "auto",
                targetLang,
                currentEngine,
                { deepl: deeplApiKey, gemini: geminiApiKey, deepseek: deepseekApiKey },
                channelId
            );

            if (result) {
                TranslationCache.getInstance().outgoingCache.set(result.trim(), message.content);
                message.content = result;
            }
        } finally {
            translatingActiveCount--;
            if (translatingActiveCount === 0) {
                document.body.classList.remove("bat-translating-active");
            }
        }
    },
});
