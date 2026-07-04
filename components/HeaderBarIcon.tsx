/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Removed isQuotaBlocked import
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { findComponentByCodeLazy } from "@webpack";
import { Menu, Popout, SelectedChannelStore, Toasts,useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

// Removed getDeepLUsage import
import { getDeepSeekBalance } from "../api/deepseek";
import { reScheduleAllWorkers, resetTranslationQueues } from "../api/translate";
import { deeplWorkers, geminiWorkers } from "../api/worker";
import { CHANNEL_ENGINE_OPTIONS, GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import { addChannel, removeChannel,settings, updateChannel } from "../settings";
import { TranslationCache } from "../utils/cache";
import { triggerManualBatch } from "../utils/manual";
import { DeepLIcon, DeepSeekIcon,GeminiIcon } from "./Icons";

const HeaderBarIconNative = findComponentByCodeLazy(
    ".HEADER_BAR_BADGE_BOTTOM,",
    'position:"bottom"'
);

function TranslateIcon(props: any) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
        </svg>
    );
}

export function TranslateHeaderButton() {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    const [dsUsageText, setDsUsageText] = useState<string | null>(null);
    const lastFetchRef = useRef<number>(0);

    // Fetch usage when dropdown opens (throttle to once per minute)
    useEffect(() => {
        if (show) {
            const now = Date.now();
            if (now - lastFetchRef.current > 60000) {
                lastFetchRef.current = now;

                if (settings.store.deepseekApiKey) {
                    getDeepSeekBalance(settings.store.deepseekApiKey).then(res => {
                        if (res) {
                            // setDsUsageText(`(${res})`);
                        }
                    });
                }
            }
        }
    }, [show, settings.store.deeplApiKey, settings.store.deepseekApiKey]);

    // Reactively update when channel changes
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());

    // Reactively update when settings change
    const {
        channelList = [],
        translationEngine = "gemini",
        translateOutgoing = false,
        hideOriginal = false,
        enableTranslation = true,
        translationMode = "global",
        manualTranslationEngine = "gemini"
    } = settings.use(["channelList", "translationEngine", "translateOutgoing", "hideOriginal", "enableTranslation", "translationMode", "manualTranslationEngine"]);

    useEffect(() => {
        if (!enableTranslation) {
            resetTranslationQueues();
            TranslationCache.getInstance().flush();
        }
    }, [enableTranslation]);

    const channelConfig = channelList.find(c => c.id === channelId);
    const isChannelListed = !!channelConfig;

    const effectiveEngine = isChannelListed && channelConfig?.engine && channelConfig.engine !== "default"
        ? channelConfig.engine
        : translationEngine;

    const isActive = enableTranslation && (translationMode === "global" || isChannelListed);

    const ActiveIcon = (props: any) => {
        if (!isActive) return <TranslateIcon {...props} />;

        if (effectiveEngine === "deepl") return <DeepLIcon {...props} />;
        if (effectiveEngine?.startsWith("deepseek")) return <DeepSeekIcon {...props} />;
        if (effectiveEngine?.startsWith("gemini")) return <GeminiIcon {...props} />;
        return <TranslateIcon {...props} />;
    };

    const renderMenu = () => {
        if (!channelId) return null;

        const channels = settings.store.channelList;
        const isChannelListed = channels.some(c => c.id === channelId);

        const toggleChannelWhitelist = () => {
            if (isChannelListed) {
                removeChannel(channelId);
                const msg = translationMode === "global"
                    ? "Channel override removed."
                    : "Translation disabled for this channel.";
                Toasts.show({ message: msg, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            } else {
                addChannel(channelId, "auto");
                const msg = translationMode === "global"
                    ? "Channel override added."
                    : "Translation enabled for this channel.";
                Toasts.show({ message: msg, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
            }
        };

        const engineOpts = CHANNEL_ENGINE_OPTIONS.map(opt => {
            if (opt.value === "default") {
                const globalLabel = GLOBAL_ENGINE_OPTIONS.find(o => o.value === translationEngine)?.label || "Unknown";
                return { ...opt, label: `Default (${globalLabel})` };
            }
            return opt;
        });

        const currentEngine = isChannelListed
            ? (channelConfig?.engine || "default")
            : "default";



        const autoEngineItems = (
                <Menu.MenuGroup label="Auto Translation Engine">
                    {engineOpts.map(opt => (
                        <Menu.MenuRadioItem
                            key={opt.value}
                            id={`engine-${opt.value}`}
                            label={

                                opt.value.startsWith("deepseek") && dsUsageText ? `${opt.label} ${dsUsageText}` :
                                opt.label
                            }
                            checked={currentEngine === opt.value}
                            dontCloseOnActionIf={() => true}
                            action={() => {
                                if (opt.value === "default") {
                                    if (isChannelListed) updateChannel(channelId, { engine: undefined });
                                } else {
                                    if (!isChannelListed) {
                                        addChannel(channelId, "auto");
                                        const msg = translationMode === "global"
                                            ? "Channel override added."
                                            : "Translation enabled for this channel.";
                                        Toasts.show({ message: msg, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
                                    }
                                    updateChannel(channelId, { engine: opt.value });
                                }
                            }}
                        />
                    ))}
                </Menu.MenuGroup>
        );

        const toggles = (
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem
                    id="toggle-outgoing"
                    label="Translate My Typing (Outgoing)"
                    checked={settings.store.translateOutgoing}
                    dontCloseOnActionIf={() => true}
                    action={() => { settings.store.translateOutgoing = !settings.store.translateOutgoing; }}
                />
                <Menu.MenuCheckboxItem
                    id="toggle-hide-original"
                    label="Hide Original Message"
                    checked={settings.store.hideOriginal}
                    dontCloseOnActionIf={() => true}
                    action={() => { settings.store.hideOriginal = !settings.store.hideOriginal; }}
                />
            </Menu.MenuGroup>
        );

        const activeChannelsCount = channelList.length;
        const scopeText = translationMode === "global"
            ? "Global (All Channels)"
            : `Selected Channels (${activeChannelsCount})`;

        const whitelistLabel = translationMode === "global"
            ? "Add Custom Settings Override"
            : "Whitelist This Channel";

        const whitelistItems = (
            <Menu.MenuGroup label={`Translation Scope: ${scopeText}`}>
                <Menu.MenuCheckboxItem
                    id="whitelist-toggle"
                    label={whitelistLabel}
                    checked={isChannelListed}
                    dontCloseOnActionIf={() => true}
                    action={toggleChannelWhitelist}
                />
            </Menu.MenuGroup>
        );

        const manualEngineItems = (
            <Menu.MenuGroup>
                <Menu.MenuItem id="manual-engine-select" label="Manual Translate Engine">
                    {GLOBAL_ENGINE_OPTIONS.map(opt => (
                        <Menu.MenuRadioItem
                            key={opt.value}
                            id={`manual-engine-${opt.value}`}
                            label={
                                opt.value.startsWith("deepseek") && dsUsageText ? `${opt.label} ${dsUsageText}` :
                                opt.label
                            }
                            checked={manualTranslationEngine === opt.value}
                            dontCloseOnActionIf={() => true}
                            action={() => {
                                settings.store.manualTranslationEngine = opt.value;
                            }}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuGroup>
        );

        const applyPreset = (name: string, threshold: number, waitMs: number) => {
            settings.store.APIEcoModeThreshold = threshold;
            settings.store.APIMaxBatchWait = waitMs;
            reScheduleAllWorkers();
            Toasts.show({
                message: `Applied ${name} Preset!`,
                type: Toasts.Type.SUCCESS,
                id: Toasts.genId()
            });
        };

        const presetItems = (
            <Menu.MenuGroup>
                <Menu.MenuItem id="eco-preset-select" label="Eco Mode Presets">
                    <Menu.MenuItem
                        id="preset-realtime"
                        label="⚡ Real-time"
                        action={() => applyPreset("Real-time", 1, 0)}
                    />
                    <Menu.MenuItem
                        id="preset-balance"
                        label="⚖️ Balance"
                        action={() => applyPreset("Balance", 3, 10)}
                    />
                    <Menu.MenuItem
                        id="preset-economy"
                        label="💰 Economy"
                        action={() => applyPreset("Economy", 10, 30)}
                    />
                    <Menu.MenuItem
                        id="preset-sleep"
                        label="💤 Sleep"
                        action={() => applyPreset("Sleep", 250, 0)}
                    />
                </Menu.MenuItem>
            </Menu.MenuGroup>
        );

        if (!isChannelListed) {
            return (
                <Menu.Menu navId="bat-translate-menu" onClose={() => setShow(false)} aria-label="Translate Options">
                    {whitelistItems}
                    <Menu.MenuSeparator />
                    {autoEngineItems}
                    <Menu.MenuSeparator />
                    {manualEngineItems}
                    <Menu.MenuSeparator />
                    {presetItems}
                    <Menu.MenuSeparator />
                    {toggles}
                </Menu.Menu>
            );
        }

        const languageItems = LANGUAGES.map(lang => (
            <Menu.MenuRadioItem
                key={lang.value}
                id={`lang-${lang.value}`}
                label={lang.label}
                checked={channelConfig?.lang === lang.value}
                dontCloseOnActionIf={() => true}
                action={() => {
                    updateChannel(channelId, { lang: lang.value });
                }}
            />
        ));

        return (
            <Menu.Menu navId="bat-translate-menu" onClose={() => setShow(false)} aria-label="Translate Options">
                {whitelistItems}
                <Menu.MenuSeparator />
                {autoEngineItems}
                <Menu.MenuSeparator />
                {manualEngineItems}
                <Menu.MenuSeparator />
                <Menu.MenuGroup>
                    <Menu.MenuItem id="lang-select" label="Source Language (Incoming)">
                        {languageItems}
                    </Menu.MenuItem>
                </Menu.MenuGroup>
                <Menu.MenuSeparator />
                {presetItems}
                <Menu.MenuSeparator />
                {toggles}
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
}

export const ManualBatchChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());

    const {
        channelList = [],
        translationEngine = "gemini",
        enableTranslation = true,
        translationMode = "global",
        manualTranslationEngine = "gemini",
        geminiApiKey,
        deeplApiKey
    } = settings.use(["channelList", "translationEngine", "enableTranslation", "translationMode", "manualTranslationEngine", "geminiApiKey", "deeplApiKey"]);

    if (!isMainChat || manualTranslationEngine === "disable") return null;

    const channelConfig = channelList.find(c => c.id === channelId);
    const isChannelListed = !!channelConfig;

    const effectiveEngine = isChannelListed && channelConfig?.engine && channelConfig.engine !== "default"
        ? channelConfig.engine
        : translationEngine;

    const isGemini = manualTranslationEngine.startsWith("gemini");
    const isDeepSeek = manualTranslationEngine.startsWith("deepseek");
    const isDeepl = manualTranslationEngine === "deepl";

    const Icon = isDeepSeek ? DeepSeekIcon : (isGemini ? GeminiIcon : DeepLIcon);
    const engineName = isDeepSeek ? "DeepSeek" : (isGemini ? "Gemini" : "DeepL");

    return (
        <ChatBarButton
            className="bat-gemini-chatbar-wrapper"
            tooltip="Translate Now"
            onClick={() => {
                if (isGemini && !geminiApiKey) {
                    Toasts.show({
                        message: "Gemini API Key is required for Manual Translation. Please set it in AlwaysTranslate settings.",
                        id: "gemini-api-key-missing",
                        type: Toasts.Type.FAILURE
                    });
                    return;
                }
                if (isDeepSeek && !settings.store.deepseekApiKey) {
                    Toasts.show({
                        message: "DeepSeek API Key is required for Manual Translation. Please set it in AlwaysTranslate settings.",
                        id: "deepseek-api-key-missing",
                        type: Toasts.Type.FAILURE
                    });
                    return;
                }
                if (isDeepl && !deeplApiKey) {
                    Toasts.show({
                        message: "DeepL API Key is required for Manual Translation. Please set it in AlwaysTranslate settings.",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId()
                    });
                    return;
                }
                triggerManualBatch(isGemini || isDeepSeek);
                if (isGemini || isDeepSeek) {
                    geminiWorkers.forEach(w => w.flushNow());
                } else if (isDeepl) {
                    deeplWorkers.forEach(w => w.flushNow());
                }
            }}
        >
            <Icon width={24} height={24} className="bat-gemini-chatbar-icon" />
        </ChatBarButton>
    );
};
