/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Stores the visual progress (0 to 1) of the Gemini Eco Mode batching gauge.
 * Shared across the plugin to ensure smooth transitions when new leaders take over.
 */
class ProgressStore {
    private progress = 0;

    public get(): number {
        return this.progress;
    }

    public set(value: number): void {
        this.progress = Math.max(0, Math.min(1, value));
    }

    public reset(): void {
        this.progress = 0;
    }
}

export const globalProgressStore = new ProgressStore();
