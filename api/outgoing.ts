/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageObject } from "@api/MessageEvents";
import { ComponentDispatch, DraftStore, DraftType, ReactDOM, SelectedChannelStore } from "@webpack/common";

import { getChannelConfig, settings } from "../settings";
import { TranslationCache } from "../utils/cache";
import { shouldTranslate } from "../utils/message";
import { showTranslationToast } from "../utils/toast";
import { safeTranslate } from "./translate";

const previews = new Map<string, string>();
const pending = new Map<string, symbol>();
let activeCount = 0;

export function resetOutgoingTranslations() {
    previews.clear();
    pending.clear();
    document.body.classList.remove("bat-translating-active");
}

export async function handleOutgoingTranslation(channelId: string, message: MessageObject, isActive: () => boolean) {
    if (!settings.store.translateOutgoing || !message.content) return;
    const { allowed, config } = getChannelConfig(channelId);
    if (!allowed) return;

    if (previews.get(channelId) === message.content) {
        previews.delete(channelId);
        return;
    }
    previews.delete(channelId);
    const { ignorePrefix } = settings.store;
    if (ignorePrefix && message.content.startsWith(ignorePrefix)) {
        message.content = message.content.slice(ignorePrefix.length);
        return;
    }

    const { translationEngine, deeplApiKey, geminiApiKey, deepseekApiKey } = settings.store;
    let targetLang = config?.lang && config.lang !== "auto" ? config.lang : settings.store.targetLang || "auto";
    const clientLang = document.documentElement.lang.split("-")[0] || "en";
    if (targetLang === "auto") targetLang = clientLang;
    if (targetLang === clientLang) return;
    const engine = !config?.engine || config.engine === "default" ? translationEngine : config.engine;
    if (engine === "disable" || !shouldTranslate(message.content, targetLang)) return;
    if (pending.has(channelId)) return { cancel: true };

    const token = Symbol();
    pending.set(channelId, token);
    const original = message.content;
    const originalDraft = DraftStore.getDraft(channelId, DraftType.ChannelMessage);
    const preview = settings.store.previewOutgoing;
    activeCount++;
    document.body.classList.add("bat-translating-active");
    try {
        const result = await safeTranslate(original, "auto", targetLang, engine,
            { deepl: deeplApiKey, gemini: geminiApiKey, deepseek: deepseekApiKey },
            channelId, undefined, false, config?.outgoingCustomPrompt?.trim() || "");
        if (!isActive()) return { cancel: true };
        if (!result) {
            showTranslationToast("Translation failed. Your message was not sent.");
            return { cancel: true };
        }
        TranslationCache.getInstance().setOutgoing(channelId, result, original);
        if (!preview) {
            message.content = result;
            return;
        }

        setTimeout(() => {
            try {
                if (!isActive()) return;
                if (SelectedChannelStore.getChannelId() !== channelId ||
                    DraftStore.getDraft(channelId, DraftType.ChannelMessage) !== originalDraft) {
                    showTranslationToast("Preview cancelled because the channel or draft changed. Your message was not sent.");
                    return;
                }
                ReactDOM.flushSync(() => ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT"));
                ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: result, plainText: result });
                previews.set(channelId, result);
            } catch {
                showTranslationToast("Could not insert the translation preview. Your message was not sent.");
            }
        }, 0);
        return { cancel: true };
    } catch {
        if (isActive()) showTranslationToast("Translation failed. Your message was not sent.");
        return { cancel: true };
    } finally {
        if (pending.get(channelId) === token) pending.delete(channelId);
        if (--activeCount === 0) document.body.classList.remove("bat-translating-active");
    }
}
