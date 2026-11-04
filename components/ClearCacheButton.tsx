/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading as FormTitle } from "@components/Heading";
import { Text as FormText } from "@components/Text";
import { useState } from "@webpack/common";

import { settings } from "../settings";
import { TranslationCache } from "../utils/cache";
import { showTranslationToast } from "../utils/toast";

export function ClearCacheButton() {
    const [count, setCount] = useState(() => TranslationCache.getInstance().getTotalCount());

    return (
        <section style={{ marginBottom: "20px" }}>
            <FormTitle>Clear Cache</FormTitle>
            <FormText style={{ marginBottom: "8px" }}>
                Clears all saved translation data from memory and storage.
            </FormText>
            <Button
                variant="dangerPrimary"
                style={{ minWidth: "200px" }}
                onClick={() => {
                    TranslationCache.getInstance().clearAll();
                    settings.store.geminiQuotaLocks = {};
                    settings.store._cacheVersion = (settings.store._cacheVersion || 0) + 1;
                    setCount(0);
                    showTranslationToast("All translation caches have been cleared.", "success");
                }}
            >
                Clear All Caches ({count})
            </Button>
        </section>
    );
}
