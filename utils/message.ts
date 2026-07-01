/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";

export function shouldTranslate(content: string, targetLang: string): boolean {
    const text = content.trim();
    if (!text) return false;

    const { ignorePrefix } = settings.store;
    if (ignorePrefix && text.startsWith(ignorePrefix)) return false;

    const detectionText = text
        .replace(/<a?:\w+:\d+>/g, "")
        .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
        .replace(/(<@[!&]?\d+>|<#\d+>|https?:\/\/[^\s]+|```[\s\S]*?```|`[^`]+`)/g, "")
        .replace(/[ \t]+/g, " ")
        .trim();

    if (!detectionText || !detectionText.match(/[a-zA-Z0-9\u00C0-\u024F\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF\u0400-\u04FF]/)) {
        return false;
    }

    const resolvedTargetLang = targetLang === "auto" ? document.documentElement.lang.split("-")[0] : targetLang;

    if (resolvedTargetLang === "ko") {
        // 초단순화 최적화: 메시지에 한글이 단 하나라도 섞여있으면 무조건 번역을 생략합니다.
        const hasKorean = /[\uAC00-\uD7A3]/.test(detectionText);
        if (hasKorean) return false;

        const hasForeign = /[a-zA-Z\u00C0-\u024F\u3040-\u30FF\u4E00-\u9FFF\u0400-\u04FF]/.test(detectionText);
        if (!hasForeign) return false;
    } else if (resolvedTargetLang === "en") {
        const hasForeign = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF\u0400-\u04FF]/.test(detectionText);
        if (!hasForeign) return false;
    } else if (resolvedTargetLang === "ja") {
        const hasForeign = /[a-zA-Z\u00C0-\u024F\uAC00-\uD7A3\u0400-\u04FF]/.test(detectionText);
        if (!hasForeign) return false;
    }

    return true;
}
