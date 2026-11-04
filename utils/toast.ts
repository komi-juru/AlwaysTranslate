/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast } from "@webpack/common";

export function showTranslationToast(text: string, variant: "critical" | "success" = "critical") {
    showToast({ text, variant });
}
