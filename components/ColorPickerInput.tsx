/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ColorPicker, Forms } from "@webpack/common";

import { settings } from "../settings";

export function ColorPickerInput() {
    const { translationColor } = settings.use(["translationColor"]);

    let numColor = 10157977; // #9aff99
    try {
        if (translationColor) {
            numColor = parseInt(translationColor.replace("#", ""), 16);
            if (isNaN(numColor)) numColor = 10157977;
        }
    } catch {}

    const handleChange = (c: number) => {
        settings.store.translationColor = "#" + c.toString(16).padStart(6, "0");
    };

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Translation Color</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px" }}>
                Pick the text color for translated messages
            </Forms.FormText>
            <ColorPicker
                defaultColor={10157977}
                colors={[
                    10157977, // Default green
                    16777215, // White
                    1146986, // Brand
                    16711680, // Red
                    16776960, // Yellow
                    65535, // Cyan
                    16711935 // Magenta
                ]}
                color={numColor}
                onChange={handleChange}
            />
        </Forms.FormSection>
    );
}
