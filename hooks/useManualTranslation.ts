/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { TranslationCache } from "../utils/cache";
import { useManualBatchVersion } from "../utils/manual";

interface UseManualTranslationProps {
    enableTranslation: boolean;
    isTranslating: boolean;
    manualCacheKey: string;
    shouldTranslateContent: boolean;
    content: string;
}

/**
 * Hook to manage the manual batch translation state triggered by the chat bar icon.
 */
export function useManualTranslation({
    enableTranslation,
    isTranslating,
    manualCacheKey,
    shouldTranslateContent,
    content
}: UseManualTranslationProps) {
    const manualVersion = useManualBatchVersion();
    const [isManual, setIsManual] = useState(false);
    const previousManualVersion = useRef(manualVersion);

    // Reset manual state when plugin is disabled globally
    useEffect(() => {
        if (!enableTranslation) {
            setIsManual(false);
        }
    }, [enableTranslation]);

    // Handle Manual Batch Request
    useEffect(() => {
        if (manualVersion === 0) return;
        if (manualVersion === previousManualVersion.current) return;
        previousManualVersion.current = manualVersion;

        if (isTranslating) return;

        // If it's already translated (in cache), we just set manual to true so it renders immediately
        if (TranslationCache.getInstance().peek(manualCacheKey)) {
            setIsManual(true);
            return;
        }

        // Avoid re-triggering if it's currently pending in the cache registry
        if (TranslationCache.getInstance().getPending(manualCacheKey, content)) return;

        // Final check against target language
        if (!shouldTranslateContent) return;

        setIsManual(true);
    }, [manualVersion, isTranslating, manualCacheKey, content, shouldTranslateContent]);

    return {
        isManual,
        setIsManual
    };
}
