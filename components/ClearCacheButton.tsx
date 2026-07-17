/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Forms, Toasts, useState } from "@webpack/common";

import { settings } from "../settings";
import { TranslationCache } from "../utils/cache";

export function ClearCacheButton() {
    const [count, setCount] = useState(() => TranslationCache.getInstance().getTotalCount());

    return (
        <Forms.FormSection style={{ marginBottom: "20px" }}>
            <Forms.FormTitle>Clear Cache</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: "8px" }}>
                Clears all saved translation data from memory and storage.
            </Forms.FormText>
            <Button
                color={Button.Colors.RED}
                style={{ minWidth: "200px" }}
                onClick={() => {
                    TranslationCache.getInstance().clearAll();
                    settings.store.geminiQuotaLocks = {};
                    settings.store._cacheVersion = (settings.store._cacheVersion || 0) + 1;
                    setCount(0);
                    Toasts.show({
                        message: "All translation caches have been cleared.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            >
                Clear All Caches ({count})
            </Button>
        </Forms.FormSection>
    );
}
