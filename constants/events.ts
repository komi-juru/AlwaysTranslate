/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const getFiredEventName = (channelId: string) => `bat-gemini-fired-${channelId}`;
export const getDebouncedEventName = (channelId: string) => `bat-gemini-debounced-${channelId}`;
export const getPausedEventName = (channelId: string) => `bat-gemini-paused-${channelId}`;

export interface BatGeminiEventDetail {
    deadline?: number;
    leaderIds?: string[];
    isEcoWait?: boolean;
    ecoProgress?: number;
    startTime?: number;
    maxWaitMs?: number;
}
