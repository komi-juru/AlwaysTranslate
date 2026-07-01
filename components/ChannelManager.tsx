/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, ChannelStore, Forms, GuildStore, SearchableSelect, TextInput, Toasts, UserStore, useState, useStateFromStores } from "@webpack/common";

import { CHANNEL_ENGINE_OPTIONS, GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import {
    addChannel as addCh,
    removeChannel as removeCh,
    settings,
    updateChannel,
} from "../settings";
import { TranslationCache } from "../utils/cache";

export interface PartialChannel {
    id: string;
    lang?: string;
    engine?: string;
    aiCustomPrompt?: string;
}

export function ChannelManager() {
    const [query, setQuery] = useState("");
    const [selectedChannel, setSelectedChannel] = useState<string | undefined>();
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [cacheTick, setCacheTick] = useState(0);
    const { channelList: channels = [], translationMode = "global" } = settings.use(["channelList", "translationMode"]);

    const activeChannels = [...channels];

    const groupedChannels: Record<string, { guildName: string, channels: PartialChannel[] }> = {};
    groupedChannels.DM = { guildName: "Direct Messages", channels: [] };

    for (const ch of activeChannels) {
        const dCh = ChannelStore.getChannel?.(ch.id);
        if (dCh && dCh.guild_id) {
            const guildId = dCh.guild_id;
            if (!groupedChannels[guildId]) {
                const guildName = GuildStore.getGuild?.(guildId)?.name || `Unknown Guild (${guildId})`;
                groupedChannels[guildId] = { guildName, channels: [] };
            }
            groupedChannels[guildId].channels.push(ch);
        } else {
            groupedChannels.DM.channels.push(ch);
        }
    }

    const sortedGroups = Object.entries(groupedChannels)
        .filter(([_, data]) => data.channels.length > 0)
        .sort((a, b) => {
            if (a[0] === "DM") return -1;
            if (b[0] === "DM") return 1;
            return a[1].guildName.localeCompare(b[1].guildName);
        });

    const channelOptions = useStateFromStores([GuildStore, ChannelStore], () => {
        const opts: { label: string, value: string }[] = [];
        const seen = new Set<string>();
        try {
            const guilds = GuildStore?.getGuilds?.() ?? {};
            for (const guildId in guilds) {
                const guild = guilds[guildId];
                const guildChannels = ChannelStore.getMutableGuildChannelsForGuild?.(guildId) ?? {};
                for (const cId in guildChannels) {
                    const ch = guildChannels[cId];
                    const isHiddenPlugin = typeof ch.isHidden === "function" ? ch.isHidden() : false;
                    const isHiddenName = ch.name?.includes("___hidden___");

                    // 0: Text, 5: Announcement, 11: Public Thread, 12: Private Thread
                    if ([0, 5, 11, 12].includes(ch.type) && !seen.has(ch.id) && !isHiddenPlugin && !isHiddenName) {
                        seen.add(ch.id);
                        opts.push({ label: `${ch.name} (${guild.name})`, value: ch.id, isDm: false });
                    }
                }
            }
            const dms = ChannelStore.getSortedPrivateChannels?.() ?? [];
            for (const ch of dms) {
                if (ch && ch.id && !seen.has(ch.id)) {
                    seen.add(ch.id);
                    let dmName = ch.name;
                    // ch.recipients holds user IDs, ch.rawRecipients might hold user objects
                    const recipients = ch.recipients || (ch.rawRecipients ? ch.rawRecipients.map((r: any) => r.id) : []);

                    if (!dmName && recipients && recipients.length > 0) {
                        try {
                            const users = recipients.map((id: string) => typeof UserStore.getUser === "function" ? UserStore.getUser(id) : null).filter(Boolean);
                            if (users.length > 0) {
                                dmName = users.map((u: { globalName?: string; username?: string }) => u.globalName || u.username).join(", ");
                            }
                        } catch(e) {}
                    }

                    const finalName = dmName || "Unknown DM";
                    if (!finalName.toLowerCase().includes("deleted user")) {
                        opts.push({ label: `${finalName} (DM)`, value: ch.id, isDm: true });
                    }
                }
            }
        } catch (e) {
            console.error("[AlwaysTranslate] Channel map error:", e);
        }
        opts.sort((a, b) => {
            if (a.isDm !== b.isDm) return a.isDm ? 1 : -1;
            return a.label.localeCompare(b.label);
        });
        return opts.map(o => ({ label: o.label, value: o.value }));
    });

    const handleAdd = (id: string | undefined) => {
        if (!id) return;
        const cleanId = id.trim();
        if (!cleanId) return;

        if (!/^\d{17,20}$/.test(cleanId)) {
            Toasts.show({
                message: "Invalid channel ID format.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            setSelectedChannel(undefined);
            return;
        }

        if (channels.some((c: PartialChannel) => c.id === cleanId)) {
            Toasts.show({
                message: "Channel already in whitelist.",
                type: Toasts.Type.WARNING,
                id: Toasts.genId()
            });
            setSelectedChannel(undefined);
            return;
        }

        addCh(cleanId, "auto");
        setQuery("");
        setSelectedChannel(undefined);
    };

    const getChannelName = (id: string): string => {
        try {
            const ch = ChannelStore.getChannel?.(id);
            if (ch?.name) return ch.guild_id ? `#${ch.name}` : ch.name;
            const recipients = ch?.recipients || (ch?.rawRecipients ? ch.rawRecipients.map((r: any) => r.id) : null);
            if (recipients && recipients.length > 0) {
                const users = recipients.map((uid: string) => UserStore.getUser?.(uid)).filter(Boolean);
                if (users.length > 0) return users.map((u: { globalName?: string; username?: string }) => u.globalName || u.username).join(", ");
            }
        } catch { /* noop */ }
        return id;
    };

    const engineOpts = CHANNEL_ENGINE_OPTIONS.map(opt => {
        if (opt.value === "default") {
            const globalLabel = GLOBAL_ENGINE_OPTIONS.find(o => o.value === settings.store.translationEngine)?.label || "Unknown";
            return { ...opt, label: `Default (${globalLabel})` };
        }
        return opt;
    });

    return (
        <Forms.FormSection style={{ marginTop: 16 }}>
            <Forms.FormTitle>
                {translationMode === "global" ? "Channel Overrides" : "Translation Channels"}
            </Forms.FormTitle>
            <Forms.FormText type="description">
                {translationMode === "global"
                    ? "Global mode is active. Only channels with custom settings are listed here. They override global defaults."
                    : "Whitelist mode is active. Only these channels will be translated."}
                <br />
                Outgoing messages in these channels will be translated INTO the channel's language.
            </Forms.FormText>

            <Forms.FormDivider style={{ marginTop: "16px", marginBottom: "16px" }} />

            <div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 200px" }}>
                            <SearchableSelect
                                options={channelOptions}
                                value={selectedChannel}
                                onChange={(val: string) => {
                                    setSelectedChannel(val);
                                    handleAdd(val);
                                }}
                                placeholder="Search channel or DM name to add..."
                                closeOnSelect={true}
                                maxVisibleItems={8}
                            />
                        </div>
                    </div>

                    <div
                        style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "4px", width: "fit-content", userSelect: "none" }}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                        {showAdvanced ? "▼" : "▶"} Advanced Options
                    </div>

                    {showAdvanced && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 200px", maxWidth: "300px" }}>
                                <TextInput
                                    placeholder="Enter raw Channel or DM ID..."
                                    value={query}
                                    onChange={setQuery}
                                />
                            </div>
                            <Button
                                onClick={() => handleAdd(query)}
                                disabled={!query.trim()}
                                color={Button.Colors.GREEN}
                            >
                                Add
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <Forms.FormDivider style={{ marginTop: "16px", marginBottom: "16px" }} />

            <div style={{ marginBottom: "16px", background: "var(--background-secondary-alt)", padding: "12px", borderRadius: "8px", borderLeft: "4px solid var(--text-brand)" }}>
                <div style={{ fontWeight: 600, color: "var(--header-primary)", marginBottom: "4px" }}>
                    Translation Scope: <span style={{ color: "var(--text-brand)" }}>
                        {translationMode === "global" ? "Global (All Channels)" : `Selected Channels (${activeChannels.length})`}
                    </span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                    {translationMode === "global"
                        ? "Auto-translate is active everywhere. Channels below have specific overrides."
                        : (activeChannels.length === 0
                            ? "No channels selected. Translation is currently disabled everywhere."
                            : "Translation is currently restricted to the selected channels below.")}
                </div>
            </div>

            <div>
                {activeChannels.length === 0 ? (
                    <Forms.FormText type="description">
                        {translationMode === "global"
                            ? "No overrides added. Translation is enabled globally with default settings."
                            : "No channels added. Add a channel to translate it."}
                    </Forms.FormText>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "8px" }}>
                        {sortedGroups.map(([guildId, { guildName, channels }]) => (
                            <div key={guildId} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <div style={{ fontWeight: 600, color: "var(--header-primary)", fontSize: "16px", paddingBottom: "4px", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                                    {guildName}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingLeft: "12px", borderLeft: "2px solid var(--background-modifier-accent)" }}>
                                    {channels.map((ch: PartialChannel) => (
                                        <div key={ch.id} style={{ display: "flex", flexDirection: "column", gap: "8px", background: "var(--background-secondary)", padding: "12px", borderRadius: "8px" }}>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                                    <div style={{ flex: "1 1 auto", minWidth: 0, marginRight: "16px" }}>
                                        <div style={{ fontWeight: 600, color: "var(--text-normal)", marginBottom: "2px", padding: "2px 0", lineHeight: "1.3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {getChannelName(ch.id)}
                                        </div>
                                        <div style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            ID: {ch.id}
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "0 0 auto" }}>
                                        {!showAdvanced && (
                                            <>
                                                <div style={{ width: "160px", flexShrink: 0 }}>
                                                    <SearchableSelect
                                                        value={ch.engine ?? "default"}
                                                        options={engineOpts}
                                                        onChange={(val: string) => {
                                                            updateChannel(ch.id, { engine: val === "default" ? undefined : val });
                                                        }}
                                                        placeholder="Engine"
                                                        popoutPosition="left"
                                                    />
                                                </div>

                                                <div style={{ width: "160px", flexShrink: 0 }}>
                                                    <SearchableSelect
                                                        value={ch.lang}
                                                        options={[...LANGUAGES]}
                                                        onChange={(val: string) => updateChannel(ch.id, { lang: val })}
                                                        placeholder="Source Language"
                                                        popoutPosition="left"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        <div style={{ display: "flex", gap: "8px" }}>
                                            {showAdvanced && (
                                                <Button
                                                    color={Button.Colors.YELLOW}
                                                    look={Button.Looks.OUTLINED}
                                                    size={Button.Sizes.SMALL}
                                                    style={{ minWidth: "140px" }}
                                                    onClick={() => {
                                                        TranslationCache.getInstance().clearChannel(ch.id);
                                                        setCacheTick(t => t + 1);
                                                        Toasts.show({
                                                            message: "Channel cache cleared.",
                                                            type: Toasts.Type.SUCCESS,
                                                            id: Toasts.genId()
                                                        });
                                                    }}
                                                >
                                                    Clear Cache ({TranslationCache.getInstance().getChannelCount(ch.id)})
                                                </Button>
                                            )}
                                            <Button
                                                color={Button.Colors.RED}
                                                look={Button.Looks.OUTLINED}
                                                size={Button.Sizes.SMALL}
                                                onClick={() => removeCh(ch.id)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                            {showAdvanced && ((ch.engine && (ch.engine.startsWith("gemini") || ch.engine.startsWith("deepseek"))) || (!ch.engine && (settings.store.translationEngine.startsWith("gemini") || settings.store.translationEngine.startsWith("deepseek")))) && (
                                                <div style={{ marginTop: "8px" }}>
                                                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "4px" }}>
                                                        Custom Prompt / Instruction (Optional)
                                                    </div>
                                                    <TextInput
                                                        value={ch.aiCustomPrompt ?? ""}
                                                        onChange={(val: string) => updateChannel(ch.id, { aiCustomPrompt: val || undefined })}
                                                        placeholder="e.g. Translate keeping the casual tone and use emojis..."
                                                        style={{ width: "100%" }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Forms.FormSection>
    );
}
