/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const PREFIX = "[AlwaysTranslate]";

export const Logger = {
    info(context: string, message: string, ...args: unknown[]) {
        console.log(`${PREFIX} [${context}]`, message, ...args);
    },

    warn(context: string, message: string, error?: unknown) {
        if (error) {
            console.warn(`${PREFIX} [${context}]`, message, error);
        } else {
            console.warn(`${PREFIX} [${context}]`, message);
        }
    },

    error(context: string, message: string, error?: unknown) {
        if (error) {
            console.error(`${PREFIX} [${context}]`, message, error);
        } else {
            console.error(`${PREFIX} [${context}]`, message);
        }
    }
};
