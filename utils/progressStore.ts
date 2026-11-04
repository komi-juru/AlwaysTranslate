/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const progress = new Map<string, number>();

export const globalProgressStore = {
    get(channelId: string) { return progress.get(channelId) ?? 0; },
    set(channelId: string, value: number) {
        progress.set(channelId, Math.max(0, Math.min(1, value)));
        if (progress.size > 100) progress.delete(progress.keys().next().value!);
    },
    reset(channelId: string) { progress.delete(channelId); }
};
