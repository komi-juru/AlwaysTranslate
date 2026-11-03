/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { TRANSLATION_TIMEOUT_MS } from "./errors";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

/** Forward renderer cancellation through IPC to the actual HTTP request. */
export async function nativeRequest<T>(request: (id: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    let rejectAbort!: (reason: Error) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => {
        void Native.batCancelRequest(id).catch(() => {});
        rejectAbort(new Error("Translation cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
        void Native.batCancelRequest(id).catch(() => {});
        rejectAbort(new Error("Translation timed out (20s)"));
    }, TRANSLATION_TIMEOUT_MS);
    try {
        const result = await Promise.race([request(id), aborted]);
        signal?.throwIfAborted();
        return result;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
    }
}
