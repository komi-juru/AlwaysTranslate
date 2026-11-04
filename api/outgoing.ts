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

const previews = new Map<string, { text: string; expires: number }>();
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let watchingDrafts = false;

function syncPreviews(checkDrafts = true) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = undefined;
    for (const [channel, entry] of previews) {
        if (entry.expires <= Date.now() || (checkDrafts && DraftStore.getDraft(channel, DraftType.ChannelMessage) !== entry.text)) previews.delete(channel);
    }
    if (!previews.size) {
        if (watchingDrafts) DraftStore.removeChangeListener(syncPreviews);
        watchingDrafts = false;
        return;
    }
    if (!watchingDrafts) DraftStore.addChangeListener(syncPreviews);
    watchingDrafts = true;
    const expires = Math.min(...Array.from(previews.values(), entry => entry.expires));
    previewTimer = setTimeout(syncPreviews, Math.max(1, expires - Date.now()));
}

function forgetPreview(channel: string) {
    previews.delete(channel);
    syncPreviews();
}
const pending = new Map<string, AbortController>();
const previewInsertions = new Set<ReturnType<typeof setTimeout>>();

export function resetOutgoingTranslations() {
    for (const timer of previewInsertions) clearTimeout(timer);
    previewInsertions.clear();
    previews.clear();
    syncPreviews();
    pending.forEach(controller => controller.abort());
    pending.clear();
    clearDetectedLanguages();
    document.body.classList.remove("bat-translating-active");
}

export async function handleOutgoingTranslation(channelId: string, message: MessageObject, isActive: () => boolean) {
    if (!settings.store.translateOutgoing || !message.content) return;
    const { allowed, config } = getChannelConfig(channelId);
    if (!allowed) return;

    if (previews.get(channelId)?.text === message.content) {
        forgetPreview(channelId);
        return;
    }
    forgetPreview(channelId);
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
            if (!isActive() || token.signal.aborted) return { cancel: true };
            if (!language) {
                showTranslationToast("Could not detect the other person's language. Set a channel language before sending.");
                return { cancel: true };
            }
            targetLang = language;
            if (!shouldTranslate(original, targetLang)) return;
        }
        const result = await safeTranslate(original, "auto", targetLang, engine,
            { gemini: geminiApiKey, deepseek: deepseekApiKey },
            channelId, undefined, config?.outgoingCustomPrompt?.trim() || "", true);
        if (!isActive() || token.signal.aborted) return { cancel: true };
        if (!result) {
            showTranslationToast("Translation failed. Your message was not sent.");
            return { cancel: true };
        }
        if (result === original) return;
        TranslationCache.getInstance().setOutgoing(channelId, result, original);
        if (!preview) {
            message.content = result;
            return;
        }

        const insertion = setTimeout(() => {
            previewInsertions.delete(insertion);
            try {
                if (!isActive() || token.signal.aborted) return;
                if (SelectedChannelStore.getChannelId() !== channelId ||
                    DraftStore.getDraft(channelId, DraftType.ChannelMessage) !== originalDraft) {
                    showTranslationToast("Preview cancelled because the channel or draft changed. Your message was not sent.");
                    return;
                }
                ReactDOM.flushSync(() => ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT"));
                ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: result, plainText: result });
                previews.delete(channelId);
                previews.set(channelId, { text: result, expires: Date.now() + 10 * 60_000 });
                if (previews.size > 100) previews.delete(previews.keys().next().value!);
                syncPreviews(false);
            } catch {
                showTranslationToast("Could not insert the translation preview. Your message was not sent.");
            }
        }, 0);
        previewInsertions.add(insertion);
        return { cancel: true };
    } catch {
        if (isActive() && !token.signal.aborted) showTranslationToast("Translation failed. Your message was not sent.");
        return { cancel: true };
    } finally {
        if (pending.get(channelId) === token) pending.delete(channelId);
        if (pending.size === 0) document.body.classList.remove("bat-translating-active");
    }
}
