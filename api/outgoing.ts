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
import { clearDetectedLanguages, detectOutgoingLanguage } from "./detectLanguage";
import { TRANSLATION_TIMEOUT_MS } from "./errors";
import { safeTranslate } from "./translate";

const previews = new Map<string, string>();
const pending = new Map<string, AbortController>();
let activeCount = 0;

export function resetOutgoingTranslations() {
    previews.clear();
    pending.forEach(controller => controller.abort());
    pending.clear();
    clearDetectedLanguages();
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

    const { translationEngine, geminiApiKey, deepseekApiKey } = settings.store;
    let targetLang = config?.lang || "auto";
    const engine = !config?.engine || config.engine === "default" ? translationEngine : config.engine;
    if (engine === "disable") return;
    if (targetLang === "auto" && !shouldTranslate(message.content, "und")) return;
    if (targetLang !== "auto" && !shouldTranslate(message.content, targetLang)) return;
    if (pending.has(channelId)) return { cancel: true };

    const token = new AbortController();
    pending.set(channelId, token);
    const original = message.content;
    const originalDraft = DraftStore.getDraft(channelId, DraftType.ChannelMessage);
    const preview = settings.store.previewOutgoing;
    activeCount++;
    document.body.classList.add("bat-translating-active");
    try {
        if (targetLang === "auto") {
            const timer = setTimeout(() => token.abort(), TRANSLATION_TIMEOUT_MS);
            let language: string | null;
            try {
                language = await detectOutgoingLanguage(channelId, engine, token.signal);
            } finally {
                clearTimeout(timer);
            }
            if (!isActive()) return { cancel: true };
            if (!language) {
                showTranslationToast("Could not detect the other person's language. Set a channel language before sending.");
                return { cancel: true };
            }
            targetLang = language;
            if (!shouldTranslate(original, targetLang)) return;
        }
        const result = await safeTranslate(original, "auto", targetLang, engine,
            { gemini: geminiApiKey, deepseek: deepseekApiKey },
            channelId, undefined, config?.outgoingCustomPrompt?.trim() || "");
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
