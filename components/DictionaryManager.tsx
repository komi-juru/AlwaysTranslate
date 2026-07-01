/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Forms, TextInput,useState } from "@webpack/common";

import { useDictionary } from "../dict";

export function DictionaryManager() {
    const [original, setOriginal] = useState("");
    const [translated, setTranslated] = useState("");

    const { dict, add, remove } = useDictionary();
    const dictionaryEntries = Object.entries(dict);

    const handleAdd = () => {
        const cleanOriginal = original.trim();
        const cleanTranslated = translated.trim();

        if (!cleanOriginal || !cleanTranslated) return;

        add(cleanOriginal, cleanTranslated);
        setOriginal("");
        setTranslated("");
    };

    return (
        <Forms.FormSection style={{ marginTop: 16 }}>
            <Forms.FormTitle>Custom Dictionary ({dictionaryEntries.length})</Forms.FormTitle>
            <Forms.FormText type="description">
                Force specific words to translate to your exact preferences (e.g., game jargon or names).<br/>Longer words are matched first. CJK strings ignore boundaries.
            </Forms.FormText>

            <Forms.FormDivider style={{ marginTop: "16px", marginBottom: "16px" }} />

            <div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
                    <div style={{ flex: "1 1 150px" }}>
                        <TextInput
                            placeholder="Original word (e.g. ナイト)"
                            value={original}
                            onChange={setOriginal}
                        />
                    </div>
                    <div style={{ flex: "0 0 auto", color: "var(--text-muted)" }}>→</div>
                    <div style={{ flex: "1 1 150px" }}>
                        <TextInput
                            placeholder="Translation (e.g. Knight)"
                            value={translated}
                            onChange={setTranslated}
                        />
                    </div>
                    <Button
                        onClick={handleAdd}
                        disabled={!original.trim() || !translated.trim()}
                        color={Button.Colors.GREEN}
                    >
                        Add
                    </Button>
                </div>

                {dictionaryEntries.length === 0 ? (
                    <Forms.FormText type="description">
                        Your custom dictionary is empty.
                    </Forms.FormText>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "8px" }}>
                        {dictionaryEntries.map(([orig, trans]) => (
                            <div key={orig} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", backgroundColor: "var(--background-secondary)", borderRadius: "6px" }}>
                                <div
                                    style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", cursor: "pointer" }}
                                    onClick={() => {
                                        setOriginal(orig);
                                        setTranslated(trans);
                                    }}
                                    title="Click to edit"
                                >
                                    <span style={{ fontWeight: 600, color: "var(--header-primary)" }}>{orig}</span>
                                    <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>→</span>
                                    <span style={{ color: "var(--text-normal)" }}>{trans}</span>
                                </div>
                                <Button
                                    color={Button.Colors.RED}
                                    onClick={() => remove(orig)}
                                    size={Button.Sizes.SMALL}
                                    look={Button.Looks.OUTLINED}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Forms.FormSection>
    );
}
