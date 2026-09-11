/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

/** Forward renderer cancellation through IPC to the actual HTTP request. */
export async function nativeRequest<T>(request: (id: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const abort = () => { void Native.batCancelRequest(id); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
        const result = await request(id);
        signal?.throwIfAborted();
        return result;
    } finally {
        signal?.removeEventListener("abort", abort);
    }
}
