/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Forms, SearchableSelect, TextInput } from "@webpack/common";

import { reScheduleAllWorkers } from "../api/translate";
import { settings } from "../settings";

const presets = [
    { name: "Real-time", threshold: 1, wait: 0 },
    { name: "Balanced", threshold: 3, wait: 10 },
    { name: "Economy", threshold: 10, wait: 30 },
    { name: "Sleep", threshold: 250, wait: 0 }
];

export function SettingsPresets() {
    const { APIEcoModeThreshold: threshold, APIMaxBatchWait: wait } = settings.use(["APIEcoModeThreshold", "APIMaxBatchWait"]);
    const current = presets.find(p => p.threshold === threshold && p.wait === wait);
    const update = (count: number, seconds: number) => {
        settings.store.APIEcoModeThreshold = count;
        settings.store.APIMaxBatchWait = seconds;
        reScheduleAllWorkers();
    };

    return (
        <section className="bat-settings-section">
            <Forms.FormTitle>Translation timing</Forms.FormTitle>
            <Forms.FormText>Gemini and DeepSeek batching.</Forms.FormText>
            <div style={{ marginTop: 8 }}>
                <SearchableSelect
                    value={current?.name ?? "Custom"}
                    options={[...presets.map(p => ({ label: p.name, value: p.name })), { label: "Custom", value: "Custom" }]}
                    onChange={(value: string) => {
                        const preset = presets.find(p => p.name === value);
                        if (preset) update(preset.threshold, preset.wait);
                    }}
                />
            </div>
            <div className="bat-settings-fields">
                <div>
                    <Forms.FormTitle>Messages</Forms.FormTitle>
                    <TextInput type="number" value={String(threshold)} onChange={(value: string) => {
                        const count = Number(value);
                        if (value && Number.isInteger(count) && count >= 1 && count <= 1000) update(count, wait);
                    }} />
                </div>
                <div>
                    <Forms.FormTitle>Wait (seconds)</Forms.FormTitle>
                    <TextInput type="number" value={String(wait)} onChange={(value: string) => {
                        const seconds = Number(value);
                        if (value && Number.isInteger(seconds) && seconds >= 0 && seconds <= 300) update(threshold, seconds);
                    }} />
                </div>
            </div>
            <Forms.FormText>0 seconds: wait for the message count.</Forms.FormText>
        </section>
    );
}
