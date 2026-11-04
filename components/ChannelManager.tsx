/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Heading as FormTitle } from "@components/Heading";
import { Text as FormText } from "@components/Text";
import { ChannelStore, GuildStore, SearchableSelect, TextInput, UserStore, useState, useStateFromStores } from "@webpack/common";

import { CHANNEL_ENGINE_OPTIONS, GLOBAL_ENGINE_OPTIONS, LANGUAGES } from "../constants";
import {
    addChannel as addCh,
    removeChannel as removeCh,
    settings,
    updateChannel,
} from "../settings";
import { showTranslationToast } from "../utils/toast";

export interface PartialChannel {
    id: string;
    lang?: string;
    engine?: string;
    aiCustomPrompt?: string;
    outgoingCustomPrompt?: string;
}

export function ChannelManager() {
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
    const [selectedChannel, setSelectedChannel] = useState<string | undefined>();
    const [expandedChannels, setExpandedChannels] = useState<string[]>([]);
    const { channelList: channels = [], translationMode = "global", translationEngine = "gemini" } = settings.use(["channelList", "translationMode", "translationEngine"]);

    const activeChannels = [...channels];

    const groupedChannels: Record<string, { guildName: string, channels: PartialChannel[] }> = {};
    groupedChannels.DM = { guildName: "Direct Messages", channels: [] };

    for (const ch of activeChannels) {
        const dCh = ChannelStore.getChannel?.(ch.id);
        if (dCh && dCh.guild_id) {
            const guildId = dCh.guild_id;
            if (!groupedChannels[guildId]) {
                const guildName = GuildStore.getGuild?.(guildId)?.name || "Unavailable server";
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
        const opts: { label: string, value: string, isDm: boolean }[] = [];
        const seen = new Set<string>();
        try {
            const guilds = GuildStore?.getGuilds?.() ?? {};
            for (const guildId in guilds) {
                const guild = guilds[guildId];
                const guildChannels = ChannelStore.getMutableGuildChannelsForGuild?.(guildId) ?? {};
                for (const cId in guildChannels) {
                    const ch = guildChannels[cId] as typeof guildChannels[string] & { isHidden?: () => boolean };
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
                            const users = recipients.map((id: string) => typeof UserStore.getUser === "function" ? UserStore.getUser(id) : null).filter((user): user is NonNullable<typeof user> => user !== null);
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
            showTranslationToast("Invalid channel ID format.");
            setSelectedChannel(undefined);
            return;
        }

        if (channels.some((c: PartialChannel) => c.id === cleanId)) {
            showTranslationToast("Channel already added.");
            setSelectedChannel(undefined);
            return;
        }

        addCh(cleanId, "auto");
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
        return "Unavailable channel";
    };

    const engineOpts = CHANNEL_ENGINE_OPTIONS.map(opt => {
        if (opt.value === "default") {
            const globalLabel = GLOBAL_ENGINE_OPTIONS.find(o => o.value === settings.store.translationEngine)?.label || "Unknown";
            return { ...opt, label: `Default (${globalLabel})` };
        }
        return opt;
    });

    return (
        <section style={{ marginTop: 16 }}>
            <FormTitle>
                {translationMode === "global" ? "Channel-specific settings" : "Selected channels"}
            </FormTitle>
            <FormText>
                {translationMode === "global"
                    ? "Set an engine, language and prompts per channel."
                    : "Only listed channels are translated automatically."}
                <br />
                Channel language: their language. Auto uses the latest message from another person for outgoing translation.
            </FormText>

            <Divider style={{ marginTop: "16px", marginBottom: "16px" }} />

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

                </div>
            </div>

            <Divider style={{ marginTop: "16px", marginBottom: "16px" }} />

            {!activeChannels.length && <FormText>No channels added.</FormText>}
            {sortedGroups.map(([guildId, group]) => {
                return <details key={guildId} className="bat-channel-group" open={expandedGroups.includes(guildId)}
                    onToggle={event => {
                        const { open } = event.currentTarget;
                        setExpandedGroups(ids => open ? ids.includes(guildId) ? ids : [...ids, guildId] : ids.filter(id => id !== guildId));
                    }}>
                    <summary>{group.guildName} · {group.channels.length}</summary>
                    {(expandedGroups.includes(guildId)) && group.channels.map(ch => {
                        const engine = !ch.engine || ch.engine === "default" ? translationEngine : ch.engine;
                        const engineName = GLOBAL_ENGINE_OPTIONS.find(option => option.value === engine)?.label ?? engine;
                        const language = LANGUAGES.find(option => option.value === (ch.lang ?? "auto"))?.label ?? ch.lang;
                        return <details key={ch.id} id={"bat-channel-" + ch.id} className="bat-channel-entry" open={expandedChannels.includes(ch.id)}
                            onToggle={event => {
                                const { open } = event.currentTarget;
                                setExpandedChannels(ids => open ? ids.includes(ch.id) ? ids : [...ids, ch.id] : ids.filter(id => id !== ch.id));
                            }}>
                            <summary title={getChannelName(ch.id) + " · " + engineName + " · " + language}>
                                {getChannelName(ch.id)} · {engineName} · {language}
                            </summary>
                            {expandedChannels.includes(ch.id) && <div className="bat-channel-detail">
                                <div className="bat-channel-controls">
                                    <div><div className="bat-settings-field-label">Translation engine</div>
                                        <SearchableSelect value={ch.engine ?? "default"} options={engineOpts}
                                            onChange={(value: string) => updateChannel(ch.id, { engine: value === "default" ? undefined : value })} />
                                    </div>
                                    <div><div className="bat-settings-field-label">Channel language</div>
                                        <SearchableSelect value={ch.lang ?? "auto"} options={[...LANGUAGES]}
                                            onChange={(value: string) => updateChannel(ch.id, { lang: value })} />
                                    </div>
                                </div>
                                <div className="bat-settings-field-label">Incoming prompt</div>
                                <TextInput value={ch.aiCustomPrompt ?? ""} onChange={(value: string) => updateChannel(ch.id, { aiCustomPrompt: value || undefined })} />
                                <div className="bat-settings-field-label">Outgoing prompt</div>
                                <TextInput value={ch.outgoingCustomPrompt ?? ""} onChange={(value: string) => updateChannel(ch.id, { outgoingCustomPrompt: value || undefined })} />
                                <Button size="small" variant="dangerPrimary" onClick={() => {
                                    removeCh(ch.id);
                                    setExpandedChannels(ids => ids.filter(id => id !== ch.id));
                                }}>Remove</Button>
                            </div>}
                        </details>;
                    })}
                </details>;
            })}
        </section>
    );
}
