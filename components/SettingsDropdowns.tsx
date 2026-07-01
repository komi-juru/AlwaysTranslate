/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Forms, SearchableSelect } from "@webpack/common";

import { GLOBAL_ENGINE_OPTIONS,LANGUAGES } from "../constants";
import { settings } from "../settings";

export function TargetLangDropdown({ setValue }: { setValue: (val: string) => void }) {
    const { targetLang } = settings.use(["targetLang"]);

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Target Language</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px" }}>
                Messages will be translated into this language.
            </Forms.FormText>
            <SearchableSelect
                value={targetLang}
                options={[...LANGUAGES]}
                onChange={(val: string) => {
                    settings.store.targetLang = val;
                    setValue(val);
                }}
                placeholder="Search language..."
                popoutPosition="bottom"
            />
        </Forms.FormSection>
    );
}

export function TranslationEngineDropdown({ setValue }: { setValue: (val: string) => void }) {
    const { translationEngine } = settings.use(["translationEngine"]);

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Default Translation Engine</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px" }}>
                Default engine applied to newly added channels or DMs.
            </Forms.FormText>
            <SearchableSelect
                value={translationEngine}
                options={[...GLOBAL_ENGINE_OPTIONS]}
                onChange={(val: string) => {
                    settings.store.translationEngine = val;
                    setValue(val);
                }}
                placeholder="Search engine..."
                popoutPosition="bottom"
            />
        </Forms.FormSection>
    );
}
