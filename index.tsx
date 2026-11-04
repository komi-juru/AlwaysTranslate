/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { Divider } from "@components/Divider";
import { Heading as FormTitle } from "@components/Heading";
import definePlugin from "@utils/types";

import { handleOutgoingTranslation, resetOutgoingTranslations } from "./api/outgoing";
import { resetTranslationQueues } from "./api/translate";
import { ApiKeysManager } from "./components/ApiKeyInput";
import { ChannelManager } from "./components/ChannelManager";
import { ClearCacheButton } from "./components/ClearCacheButton";
import { ColorPickerInput } from "./components/ColorPickerInput";
import { GithubLinkInjector } from "./components/GithubLinkInjector";
import { TranslateHeaderButton } from "./components/HeaderBarIcon";
import { SettingsOverview } from "./components/SettingsOverview";
import { SettingsPresets } from "./components/SettingsPresets";
import { TranslationAccessory } from "./components/TranslationAccessory";
import { normalizeTranslationEngines, settings } from "./settings";
import { TranslationCache } from "./utils/cache";


const SettingsHeader = ({ title }: { title: string }) => (
    <>
        <Divider style={{ marginTop: 24, marginBottom: 16 }} />
        <FormTitle tag="h2">{title}</FormTitle>
    </>
);

// Wire up dynamic COMPONENT settings (avoids circular imports)
settings.def.ui_githubLink.component = GithubLinkInjector;
settings.def.ui_overview.component = () => <SettingsOverview />;
settings.def.header_translation.component = () => <SettingsHeader title="Translation" />;
settings.def.header_management.component = () => <SettingsHeader title="Channels & Outgoing Messages" />;
settings.def.header_design.component = () => <SettingsHeader title="Appearance" />;
settings.def.channelManager.component = ChannelManager;
settings.def.ui_apiKeys.component = () => <ApiKeysManager />;


settings.def.ui_translationColor.component = ColorPickerInput;
settings.def.ui_clearCache.component = ClearCacheButton;
settings.def.ui_presets.component = () => <SettingsPresets />;

export let pluginStarted = false;

let lifecycleGeneration = 0;

export default definePlugin({
    name: "AlwaysTranslate",
    description: "Real-time AI translation.",
    authors: [{ name: "komi-juru", id: 682762388143210549n }],
    github: "https://github.com/komi-juru/AlwaysTranslate",
    settings,

    // 🔄 Lifecycle 🔄

    async start() {
        const generation = ++lifecycleGeneration;
        resetTranslationQueues();
        normalizeTranslationEngines();
        await TranslationCache.getInstance().init();
        if (generation !== lifecycleGeneration) return;
        pluginStarted = true;
        addMessageAccessory("AlwaysTranslate", props => <TranslationAccessory message={props.message} />, 0);
    },

    stop() {
        lifecycleGeneration++;
        resetOutgoingTranslations();
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

    async onBeforeMessageSend(channelId, message) {
        if (!pluginStarted) return;
        const generation = lifecycleGeneration;
        return handleOutgoingTranslation(channelId, message, () => pluginStarted && generation === lifecycleGeneration);
    },
});
