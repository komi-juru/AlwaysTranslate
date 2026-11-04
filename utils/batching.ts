/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GEMINI_BATCH_SIZE, MAX_TRANSLATION_CHARS } from "../constants";

export function splitTranslationText(text: string, limit = MAX_TRANSLATION_CHARS): { text: string; separator: string }[] {
    const parts: { text: string; separator: string }[] = [];
    let remaining = text;
    while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        let cut = 0;
        for (const boundary of [/\r?\n[ \t]*(?:\r?\n)+[ \t]*/g, /[.!?。！？]["'”’」』)]*\s*/gu, /\s+/g]) {
            let match: RegExpExecArray | null;
            while ((match = boundary.exec(window))) {
                if (match.index > 0) cut = match.index + match[0].length;
            }
            if (cut) break;
        }
        if (!cut) cut = limit;
        const tokenStart = remaining.lastIndexOf("[token", cut - 1);
        const token = tokenStart >= 0 ? remaining.slice(tokenStart).match(/^\[token\d{1,10}\]/)?.[0] : undefined;
        if (token && tokenStart + token.length > cut) cut = tokenStart;
        if (cut > 0 && /[\uD800-\uDBFF]/.test(remaining[cut - 1]) && /[\uDC00-\uDFFF]/.test(remaining[cut])) cut--;
        const head = remaining.slice(0, cut);
        const body = head.trimEnd();
        const nextWhitespace = remaining.slice(cut).match(/^\s*/)?.[0] ?? "";
        const separator = head.slice(body.length) + nextWhitespace;
        parts.push({ text: body, separator });
        remaining = remaining.slice(cut + nextWhitespace.length);
    }
    if (remaining) parts.push({ text: remaining, separator: "" });
    return parts;
}

export function batchTranslationTasks<T extends { text: string }>(tasks: T[], maxCharacters = MAX_TRANSLATION_CHARS, maxMessages = GEMINI_BATCH_SIZE): T[][] {
    const batches: T[][] = [];
    let batch: T[] = [], characters = 0;
    for (const task of tasks) {
        if (batch.length && (batch.length >= maxMessages || characters + task.text.length > maxCharacters)) {
            batches.push(batch);
            batch = [];
            characters = 0;
        }
        batch.push(task);
        characters += task.text.length;
    }
    if (batch.length) batches.push(batch);
    return batches;
}
