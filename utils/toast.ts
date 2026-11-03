/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Toasts } from "@webpack/common";

export function showTranslationToast(text: string, variant: "critical" | "success" = "critical") {
    const type = variant === "success" ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE;
    const toast = { ...Toasts.create(text, type), text, variant };
    Toasts.show(toast);
}
