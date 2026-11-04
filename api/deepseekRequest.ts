/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { httpError } from "./errors";
import { nativeRequest } from "./nativeRequest";
import { withRequestBackoff } from "./requestBackoff";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export function requestDeepSeek(payload: object, apiKey: string, model: string, endpoint: string, signal?: AbortSignal) {
    apiKey = apiKey.trim();
    return withRequestBackoff({ engine: "deepseek", apiKey, model, endpoint }, async () => {
        const response = await nativeRequest(id => Native.batDeepSeekFetch(endpoint, apiKey, JSON.stringify(payload), id), signal);
        if (!response.ok) throw httpError(response.status, String(response.data), response.retryAfter);
        return response;
    });
}

