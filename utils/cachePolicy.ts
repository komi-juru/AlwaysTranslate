/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const CACHE_BYTE_BUDGET = 8 * 1024 * 1024;
export const CACHE_ENTRY_BYTE_LIMIT = 256 * 1024;
export const CACHE_PATCH_BYTE_LIMIT = 256 * 1024;
export const CACHE_PATCH_ENTRY_LIMIT = 256;
export const DISPLAY_CACHE_BYTE_BUDGET = 1024 * 1024;
export const OUTGOING_CACHE_BYTE_BUDGET = 1024 * 1024;

export interface CachePatch {
    version: 3;
    clear: boolean;
    entries: [string, string | null][];
    persist: boolean;
}

const encoder = new TextEncoder();
export function cacheEntryBytes(key: string, value: string): number {
    return encoder.encode(JSON.stringify([key, value])).byteLength + 16;
}
