/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";


let manualBatchVersion = 0;
const listeners = new Set<(v: number) => void>();

export function getManualBatchVersion() {
    return manualBatchVersion;
}

export function triggerManualBatch(isGemini: boolean) {
    manualBatchVersion++;
    listeners.forEach(l => l(manualBatchVersion));
}

export function subscribeManualBatch(listener: (v: number) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useManualBatchVersion() {
    const [version, setVersion] = useState(manualBatchVersion);
    useEffect(() => {
        return subscribeManualBatch(setVersion);
    }, []);
    return version;
}
