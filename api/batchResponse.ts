/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface BatchTranslation {
    id: string;
    text: string;
}

export function validateBatchTranslations(value: unknown, messages: { id: string }[], allowObject = false): BatchTranslation[] {
    const entries = allowObject && value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value).map(([id, text]) => ({ id, text })) : value;
    if (!Array.isArray(entries)) throw new Error("Invalid API response: expected a translation array");
    const expected = new Set(messages.map(m => m.id));
    const results = new Map<string, string>();
    for (const entry of entries) {
        if (!entry || typeof entry.id !== "string" || typeof entry.text !== "string" || !entry.text.trim()) {
            throw new Error("Invalid API response: translation id and nonempty text must be strings");
        }
        if (!expected.has(entry.id)) throw new Error("Invalid API response: unexpected translation id");
        if (results.has(entry.id)) throw new Error("Invalid API response: duplicate translation id");
        results.set(entry.id, entry.text);
    }
    if (results.size !== expected.size) throw new Error("Invalid API response: missing translations");
    return messages.map(m => ({ id: m.id, text: results.get(m.id)! }));
}
