/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Forms, Toasts } from "@webpack/common";

import { settings } from "../settings";

export function SettingsPresets() {
    const applyPreset = (name: string, threshold: number, waitMs: number) => {
        settings.store.APIEcoModeThreshold = threshold;
        settings.store.APIMaxBatchWait = waitMs;

        Toasts.show({
            message: `Applied ${name} Preset!`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    };

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Eco Mode Presets</Forms.FormTitle>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => applyPreset("Real-time", 1, 0)}
                >
                    ⚡ Real-time
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => applyPreset("Balance", 3, 10)}
                >
                    ⚖️ Balance
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => applyPreset("Economy", 10, 30)}
                >
                    💰 Economy
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => applyPreset("Sleep", 250, 0)}
                >
                    💤 Sleep
                </Button>
            </div>
        </Forms.FormSection>
    );
}
