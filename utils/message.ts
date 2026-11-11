/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";

export const PLAIN_MENTION_PATTERN = /(?<![\p{L}\p{N}_.@])@[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/gu;

export function shouldTranslate(content: string, targetLang: string): boolean {
    const text = content.trim();
    if (!text) return false;

    const { ignorePrefix } = settings.store;
    if (ignorePrefix && text.startsWith(ignorePrefix)) return false;

    const detectionText = text
        .replace(PLAIN_MENTION_PATTERN, "")
        .replace(/<a?:\w+:\d+>/g, "")
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
        .replace(/(<@[!&]?\d+>|<#\d+>|https?:\/\/[^\s]+|```[\s\S]*?```|`[^`]+`)/g, "")
        .replace(/[ \t]+/g, " ")
        .trim();

    if (!/\p{L}/u.test(detectionText)) return false;
    const target = targetLang === "auto" ? document.documentElement.lang.split("-")[0] : targetLang;
    const letters = detectionText.replace(/[^\p{L}]/gu, "");
    if (target === "ko" && /^[\p{Script=Hangul}]+$/u.test(letters)) return false;
    if (target === "ja" && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(letters) &&
        /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+$/u.test(letters)) return false;
    return true;
}
