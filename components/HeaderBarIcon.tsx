/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings";
import { findComponentByCodeLazy } from "@webpack";
import { Menu, Popout, SelectedChannelStore, useRef, useState, useStateFromStores } from "@webpack/common";

import { reScheduleAllWorkers } from "../api/translate";
import { CHANNEL_ENGINE_OPTIONS, GLOBAL_ENGINE_OPTIONS, LANGUAGES, TRANSLATION_PRESETS } from "../constants";
import { addChannel, settings, updateChannel } from "../settings";
import { DeepSeekIcon,GeminiIcon } from "./Icons";

const HeaderBarIconNative = findComponentByCodeLazy(
    ".HEADER_BAR_BADGE_BOTTOM,",
    'position:"bottom"'
);

export function TranslateIcon(props: any) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
        </svg>
    );
}

export const TranslateHeaderButton = ErrorBoundary.wrap(function TranslateHeaderButton() {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    // Reactively update when channel changes
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());

    // Reactively update when settings change
    const {
        channelList = [],
        translationEngine = "gemini",
        translateOutgoing = false,
        hideOriginal = false,
        translationMode = "global",
        APIEcoModeThreshold = 1,
        APIMaxBatchWait = 0
    } = settings.use(["channelList", "translationEngine", "translateOutgoing", "hideOriginal", "translationMode", "APIEcoModeThreshold", "APIMaxBatchWait"]);


    const channelConfig = channelList.find(c => c.id === channelId);
    const isChannelListed = !!channelConfig;

    const effectiveEngine = isChannelListed && channelConfig?.engine && channelConfig.engine !== "default"
        ? channelConfig.engine
        : translationEngine;


    const isActive = effectiveEngine !== "disable" && (translationMode === "global" || isChannelListed);

    const ActiveIcon = (props: any) => {
        if (!isActive) return <TranslateIcon {...props} />;

        if (effectiveEngine?.startsWith("deepseek")) return <DeepSeekIcon {...props} />;
        if (effectiveEngine?.startsWith("gemini")) return <GeminiIcon {...props} />;
        return <TranslateIcon {...props} />;
    };

    const renderMenu = () => {
        if (!channelId) return null;
        const engineLabel = (value: string) => value === "disable" ? "Off" : GLOBAL_ENGINE_OPTIONS.find(o => o.value === value)?.label ?? value;
        const currentEngine = channelConfig?.engine || "default";
        const currentLanguage = channelConfig?.lang || "auto";
        const selectedPreset = TRANSLATION_PRESETS.find(p => p.threshold === APIEcoModeThreshold && p.wait === APIMaxBatchWait);
        return (
            <Menu.Menu navId="bat-translate-menu" onClose={() => setShow(false)} aria-label="AlwaysTranslate settings">
                <Menu.MenuGroup label="This channel">
                    <Menu.MenuItem id="auto-engine-select" label={`Automatic translation: ${isActive ? engineLabel(effectiveEngine) : "Off"}`}
                        subtext={!isChannelListed && translationMode !== "global" ? "Select an engine to enable." : "Off preserves channel settings."}>
                        {CHANNEL_ENGINE_OPTIONS.map(opt => (
                            <Menu.MenuRadioItem key={opt.value} id={`engine-${opt.value}`} group="bat-auto-engine"
                                label={opt.value === "default" ? `Follow default (${engineLabel(translationEngine)})` : engineLabel(opt.value)}
                                checked={!isChannelListed && translationMode !== "global" ? opt.value === "disable" : currentEngine === opt.value}
                                dontCloseOnActionIf={() => true}
                                action={() => {
                                    addChannel(channelId, "auto");
                                    updateChannel(channelId, { engine: opt.value === "default" ? undefined : opt.value });
                                }} />
                        ))}
                    </Menu.MenuItem>
                    <Menu.MenuItem id="lang-select" label={`Channel language: ${LANGUAGES.find(l => l.value === currentLanguage)?.label ?? currentLanguage}`}
                        subtext="Auto uses the latest message from another person.">
                        {LANGUAGES.map(lang => (
                            <Menu.MenuRadioItem key={lang.value} id={`lang-${lang.value}`} group="bat-channel-language"
                                label={lang.label} checked={currentLanguage === lang.value} dontCloseOnActionIf={() => true}
                                action={() => {
                                    const exists = settings.store.channelList.some(c => c.id === channelId);
                                    addChannel(channelId, lang.value);
                                    // Keep excluded channels off when saving a language.
                                    updateChannel(channelId, { lang: lang.value,
                                        ...(!exists && settings.store.translationMode !== "global" ? { engine: "disable" } : {}) });
                                }} />
                        ))}
                    </Menu.MenuItem>
                </Menu.MenuGroup>
                <Menu.MenuSeparator />
                <Menu.MenuGroup label="All channels — shared settings">
                    <Menu.MenuItem id="translation-scope" label={`Automatic scope: ${translationMode === "global" ? "All channels" : "Selected channels only"}`} disabled />
                    <Menu.MenuItem id="eco-preset-select" label={`Batch timing: ${selectedPreset?.name ?? "Custom"}`}
                        subtext="Gemini and DeepSeek · All channels">
                        {TRANSLATION_PRESETS.map(preset => (
                            <Menu.MenuRadioItem key={preset.name} id={`preset-${preset.name.toLowerCase()}`} group="bat-batch-preset"
                                label={preset.name} subtext={`${preset.threshold} messages / ${preset.wait ? `up to ${preset.wait}s` : "no timer"}`}
                                checked={selectedPreset === preset} dontCloseOnActionIf={() => true}
                                action={() => {
                                    settings.store.APIEcoModeThreshold = preset.threshold;
                                    settings.store.APIMaxBatchWait = preset.wait;
                                    reScheduleAllWorkers();
                                }} />
                        ))}
                    </Menu.MenuItem>
                    <Menu.MenuCheckboxItem id="toggle-outgoing" label="Translate my outgoing messages" checked={translateOutgoing}
                        dontCloseOnActionIf={() => true} action={() => { settings.store.translateOutgoing = !settings.store.translateOutgoing; }} />
                    <Menu.MenuCheckboxItem id="toggle-hide-original" label="Hide original messages" checked={hideOriginal}
                        dontCloseOnActionIf={() => true} action={() => { settings.store.hideOriginal = !settings.store.hideOriginal; }} />
                </Menu.MenuGroup>
                <Menu.MenuSeparator />
                <Menu.MenuItem id="open-settings" label="Open full settings" action={() => {
                    setShow(false);
                    openPluginModal(plugins.AlwaysTranslate);
                }} />
            </Menu.Menu>
        );
    };
    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={renderMenu}
        >
            {(_, { isShown }) => (
                <HeaderBarIconNative
                    ref={buttonRef}
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "AlwaysTranslate"}
                    icon={ActiveIcon}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}, { noop: true });
