/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

let cachedDictRegex: RegExp | null = null;
let cachedDictKeysStr: string = "";
let cachedCaseSensitive: boolean | null = null;

export function getDictRegex(dictKeys: string[], caseSensitive: boolean): RegExp | null {
    if (dictKeys.length === 0) return null;

    const keysStr = dictKeys.join("|||");
    if (cachedDictKeysStr === keysStr && cachedCaseSensitive === caseSensitive) {
        return cachedDictRegex;
    }

    const regexParts = dictKeys.map(key => {
        if (!key) return "";
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const isEnglish = /^[\x00-\x7F]+$/.test(key);
        const isKatakana = (c: string) => /[\u30A1-\u30FA\u30FC]/.test(c);
        const isKanji = (c: string) => /[\u4E00-\u9FAF]/.test(c);

        let boundryPrefix = isEnglish ? "\\b" : "";
        let boundrySuffix = isEnglish ? "\\b" : "";

        if (!isEnglish) {
            const firstChar = key[0];
            if (isKatakana(firstChar)) boundryPrefix = "(?<![\\u30A1-\\u30FA\\u30FC])";
            else if (isKanji(firstChar)) boundryPrefix = "(?<![\\u4E00-\\u9FAF])";

            const lastChar = key[key.length - 1];
            if (isKatakana(lastChar)) boundrySuffix = "(?![\\u30A1-\\u30FA\\u30FC])";
            else if (isKanji(lastChar)) boundrySuffix = "(?![\\u4E00-\\u9FAF])";
        }

        return `${boundryPrefix}${escapedKey}${boundrySuffix}`;
    }).filter(Boolean);

    if (regexParts.length > 0) {
        const flags = caseSensitive ? "g" : "gi";
        cachedDictRegex = new RegExp(`(${regexParts.join("|")})`, flags);
    } else {
        cachedDictRegex = null;
    }

    cachedDictKeysStr = keysStr;
    cachedCaseSensitive = caseSensitive;
    return cachedDictRegex;
}
