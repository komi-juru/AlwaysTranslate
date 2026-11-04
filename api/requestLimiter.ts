/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function createRequestLimiter(maxConcurrent: number) {
    let active = 0;
    const waiting: (() => void)[] = [];

    function acquire(signal?: AbortSignal): Promise<(() => void) | null> {
        if (signal?.aborted) return Promise.resolve(null);
        return new Promise(resolve => {
            const cancel = () => {
                const index = waiting.indexOf(start);
                if (index !== -1) waiting.splice(index, 1);
                resolve(null);
            };
            const start = () => {
                signal?.removeEventListener("abort", cancel);
                active++;
                let released = false;
                resolve(() => {
                    if (released) return;
                    released = true;
                    active--;
                    waiting.shift()?.();
                });
            };
            if (active < maxConcurrent) start();
            else {
                waiting.push(start);
                signal?.addEventListener("abort", cancel, { once: true });
            }
        });
    }

    return { acquire };
}

export const aiRequestLimiters = {
    gemini: createRequestLimiter(2),
    deepseek: createRequestLimiter(2)
};
