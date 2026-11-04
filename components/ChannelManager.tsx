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
    const [query, setQuery] = useState("");
    const [selectedChannel, setSelectedChannel] = useState<string | undefined>();
    const [showIdInput, setShowIdInput] = useState(false);
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

                    <Button size="small" variant="secondary" onClick={() => setShowIdInput(!showIdInput)}>
                        {showIdInput ? "Close channel ID" : "Add by channel ID"}
                    </Button>

                    {showIdInput && (
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
                                variant="positive"
                            >
                                Add
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <Divider style={{ marginTop: "16px", marginBottom: "16px" }} />

            <div>
                {activeChannels.length === 0 ? (
                    <FormText>
                        {translationMode === "global"
                            ? "No channel overrides."
                            : "No channels added."}
                    </FormText>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "8px" }}>
                        {sortedGroups.map(([guildId, { guildName, channels }]) => (
                            <div key={guildId} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <div style={{ fontWeight: 600, color: "var(--header-primary)", fontSize: "16px", paddingBottom: "4px", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                                    {guildName}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                    {channels.map((ch: PartialChannel) => (
                                        <div key={ch.id} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                                    <div style={{ flex: "1 1 auto", minWidth: 0, marginRight: "16px" }}>
                                        <div style={{ fontWeight: 600, color: "var(--text-normal)", marginBottom: "2px", padding: "2px 0", lineHeight: "1.3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {getChannelName(ch.id)}
                                        </div>
                                        <div style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            ID: {ch.id}
                                        </div>
                                    </div>

                                    <div className="bat-channel-controls">
                                        {(
                                            <>
                                                <div style={{ minWidth: 0 }}>
                                                    <div className="bat-settings-field-label">Automatic engine</div>
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

                                                <div style={{ minWidth: 0 }}>
                                                    <div className="bat-settings-field-label">Channel language</div>
                                                    <SearchableSelect
                                                        value={ch.lang}
                                                        options={[...LANGUAGES]}
                                                        onChange={(val: string) => updateChannel(ch.id, { lang: val })}
                                                        placeholder="Channel language"
                                                        popoutPosition="left"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        <div style={{ display: "contents" }}>
                                            <Button size="small" variant="secondary" onClick={() => setExpandedChannels(ids => ids.includes(ch.id) ? ids.filter(id => id !== ch.id) : [...ids, ch.id])}>
                                                {expandedChannels.includes(ch.id) ? "Close prompts" : "Edit prompts"}
                                            </Button>
                                            <Button
                                                variant="dangerPrimary"
                                                size="small"
                                                onClick={() => removeCh(ch.id)}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                            {expandedChannels.includes(ch.id) && (
                                                <div style={{ marginTop: "8px" }}>
                                                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "4px" }}>
                                                        Incoming prompt
                                                    </div>
                                                    <TextInput
                                                        value={ch.aiCustomPrompt ?? ""}
                                                        onChange={(val: string) => updateChannel(ch.id, { aiCustomPrompt: val || undefined })}
                                                        placeholder="e.g. Keep the original tone."
                                                        style={{ width: "100%" }}
                                                    />
                                                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginTop: "12px", marginBottom: "4px" }}>
                                                        Outgoing prompt
                                                    </div>
                                                    <TextInput
                                                        value={ch.outgoingCustomPrompt ?? ""}
                                                        onChange={(val: string) => updateChannel(ch.id, { outgoingCustomPrompt: val || undefined })}
                                                        placeholder="e.g. Use a friendly tone."
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
        </section>
    );
}
