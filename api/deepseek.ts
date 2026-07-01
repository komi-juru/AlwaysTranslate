/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { settings } from "../settings";
import { buildDeepSeekSystemPrompt, buildDeepSeekUserPrompt } from "./geminiPrompt";

const Native = VencordNative.pluginHelpers.AlwaysTranslate as PluginNative<typeof import("../native")>;

export async function translateBatchWithDeepSeek(
    channelId: string,
    messages: { id: string; text: string }[],
    targetLang: string,
    apiKey: string,
    dmPrompt: string,
    modelName: string
): Promise<{ id: string; text: string }[]> {
    if (!messages.length) return [];
    if (!apiKey) throw new Error("API Key not set");

    const systemPrompt = buildDeepSeekSystemPrompt();
    const userPrompt = buildDeepSeekUserPrompt(targetLang, dmPrompt, messages);

    const endpoint = settings.store.deepseekBaseUrl || "https://api.deepseek.com/chat/completions";
    const actualModelName = settings.store.deepseekModel || "deepseek-v4-flash";

    const isR1 = actualModelName.toLowerCase().includes("r1") || actualModelName.toLowerCase().includes("reasoner");

    // R1/Reasoner models often do NOT support the "system" role or response_format depending on provider.
    // Merge system instructions into the user message instead if it's R1.
    const chatMessages = isR1
        ? [{ role: "user", content: `${systemPrompt}\n\n${userPrompt}` }]
        : [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ];

    const payload: any = {
        model: actualModelName,
        messages: chatMessages,
        stream: false,
        temperature: 0.3,
        max_tokens: 8192
    };

    if (!isR1) {
        payload.response_format = { type: "json_object" };
        payload.thinking = { type: "disabled" }; // Explicitly disable thinking for DeepSeek V4 API
    }

    let res;
    try {
        res = await Native.batDeepSeekFetch(endpoint, apiKey, JSON.stringify(payload));
    } catch (e) {
        throw new Error("DeepSeek API network request failed");
    }

    if (!res.ok) {
        let errStr = String(res.status);
        try {
            const errObj = JSON.parse(res.data);
            errStr = errObj.error?.message || JSON.stringify(errObj);
        } catch {}

        const error = new Error(`DeepSeek API Error: ${res.status} ${errStr}`);
        (error as any).status = res.status;
        throw error;
    }

    const resultText = (() => {
        try {
            return JSON.parse(res.data).choices?.[0]?.message?.content;
        } catch {
            return null;
        }
    })();

    if (!resultText) {
        throw new Error("Empty response from DeepSeek API");
    }

    try {
        let cleanJson = resultText.trim();
        cleanJson = cleanJson.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        if (cleanJson.startsWith("```json")) {
            cleanJson = cleanJson.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (cleanJson.startsWith("```")) {
            cleanJson = cleanJson.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }

        const parsed = JSON.parse(cleanJson);

        // Handle array format: [{"id": "...", "text": "..."}]
        if (Array.isArray(parsed)) {
            const resultMap = new Map(parsed.map((r: any) => [r.id, r.text]));
            return messages.map(m => ({
                id: m.id,
                text: resultMap.get(m.id) ?? ""
            }));
        }

        // Handle object format: {"id": "translated text"}
        return messages.map(m => ({
            id: m.id,
            text: parsed[m.id] ?? ""
        }));
    } catch (e: any) {
        console.error("DeepSeek Parse error:", resultText, e);
        throw new Error("Failed to parse DeepSeek JSON response: " + e.message);
    }
}

export async function getDeepSeekBalance(apiKey: string): Promise<string | null> {
    if (!apiKey) return null;
    try {
        const response = await Native.batDeepSeekBalanceFetch(apiKey);
        console.log("DeepSeek Balance Status:", response.status);
        if (!response.ok) {
            console.log("DeepSeek Balance Error:", response.data);
            return null;
        }
        const data = JSON.parse(response.data);
        console.log("DeepSeek Balance Data:", data);
        if (data && data.is_available && data.balance_infos && data.balance_infos.length > 0) {
            const info = data.balance_infos[0];
            return `${info.total_balance} ${info.currency}`;
        }
    } catch (e) {
        console.error("DeepSeek Balance Exception:", e);
    }
    return null;
}
