/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect } from "@webpack/common";

interface UseMessageVisibilityProps {
    messageId: string;
    allowed: boolean;
    hideOriginal: boolean;
    isTranslating: boolean;
    translatedText: string | null;
}

/**
 * Hook to manage the DOM manipulation required to hide or show the original Discord message content.
 */
export function useMessageVisibility({
    messageId,
    allowed,
    hideOriginal,
    isTranslating,
    translatedText
}: UseMessageVisibilityProps) {
    useEffect(() => {
        const contentNode = document.getElementById(`message-content-${messageId}`);
        if (!contentNode) return;

        const shouldHideOriginal = allowed && hideOriginal;

        // Hide original if we are translating or already translated, AND the channel is allowed
        if (shouldHideOriginal && (isTranslating || translatedText)) {
            contentNode.style.display = "none";
        } else {
            contentNode.style.display = "";
        }

        // Cleanup: always restore visibility when unmounting to prevent ghost states
        return () => {
            contentNode.style.display = "";
        };
    }, [hideOriginal, translatedText, isTranslating, messageId, allowed]);
}
