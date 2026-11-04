/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Heading as FormTitle } from "@components/Heading";
import { Text as FormText } from "@components/Text";
import { SearchableSelect, TextInput } from "@webpack/common";

import { reScheduleAllWorkers } from "../api/translate";
import { TRANSLATION_PRESETS } from "../constants";
import { settings } from "../settings";

export const SettingsPresets = ErrorBoundary.wrap(function SettingsPresets() {
    const { APIEcoModeThreshold: threshold, APIMaxBatchWait: wait } = settings.use(["APIEcoModeThreshold", "APIMaxBatchWait"]);
    const current = TRANSLATION_PRESETS.find(p => p.threshold === threshold && p.wait === wait);
    const update = (count: number, seconds: number) => {
        settings.store.APIEcoModeThreshold = count;
        settings.store.APIMaxBatchWait = seconds;
        reScheduleAllWorkers();
    };

    return (
        <section className="bat-settings-section">
            <FormTitle>Translation timing</FormTitle>
            <FormText>Gemini and DeepSeek batching.</FormText>
            <div style={{ marginTop: 8 }}>
                <SearchableSelect
                    value={current?.name ?? "Custom"}
                    options={[...TRANSLATION_PRESETS.map(p => ({ label: p.name, value: p.name })), { label: "Custom", value: "Custom" }]}
                    onChange={(value: string) => {
                        const preset = TRANSLATION_PRESETS.find(p => p.name === value);
                        if (preset) update(preset.threshold, preset.wait);
                    }}
                />
            </div>
            <div className="bat-settings-fields">
                <div>
                    <FormTitle>Messages</FormTitle>
                    <TextInput type="number" value={String(threshold)} onChange={(value: string) => {
                        const count = Number(value);
                        if (value && Number.isInteger(count) && count >= 1 && count <= 1000) update(count, wait);
                    }} />
                </div>
                <div>
                    <FormTitle>Wait (seconds)</FormTitle>
                    <TextInput type="number" value={String(wait)} onChange={(value: string) => {
                        const seconds = Number(value);
                        if (value && Number.isInteger(seconds) && seconds >= 0 && seconds <= 300) update(threshold, seconds);
                    }} />
                </div>
            </div>
            <FormText>0 seconds: wait for the message count.</FormText>
        </section>
    );
}, { noop: true });
