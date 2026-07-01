/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { getGeminiBatchState } from "../api/translate";
import { BatGeminiEventDetail, getDebouncedEventName, getFiredEventName, getPausedEventName } from "../constants/events";
import { globalProgressStore } from "../utils/progressStore";

interface UseEcoModeEventsProps {
    isGemini: boolean;
    channelId: string;
    messageId: string;
}

export function useEcoModeEvents({ isGemini, channelId, messageId }: UseEcoModeEventsProps) {
    const hasFired = useRef(false);

    // Initialize synchronously from channel state to avoid React double-render blink
    const initialState = isGemini ? getGeminiBatchState(channelId, messageId) : null;

    const isPaused = useRef(initialState ? (initialState.isPaused || initialState.isProcessing) : false);
    const initialDeadline = (initialState && initialState.deadline) ? initialState.deadline : Date.now() + 3000;

    const targetDeadline = useRef<number>(initialDeadline);
    const targetEcoProgress = useRef<number>(initialState?.ecoProgress || 0);
    const targetStartTime = useRef<number>(initialState?.startTime || Date.now());
    const targetMaxWaitMs = useRef<number>(initialState?.maxWaitMs || 0);

    const [status, setStatus] = useState<"waiting" | "fired">(initialState?.isFired ? "fired" : "waiting");
    const [isLeader, setIsLeader] = useState(() => initialState ? (initialState.leaderIds ?? []).includes(messageId) : false);

    // Sync with global batch state
    useEffect(() => {
        if (!isGemini || status === "fired") return;

        const state = getGeminiBatchState(channelId, messageId);
        if (state) {
            if (state.isProcessing || state.isFired) {
                globalProgressStore.reset();
                setStatus("fired");
                return;
            }
            if (state.deadline !== undefined) {
                targetDeadline.current = state.deadline;
            }
            if (state.ecoProgress !== undefined) {
                targetEcoProgress.current = state.ecoProgress;
            }
            if (state.startTime !== undefined) {
                targetStartTime.current = state.startTime;
            }
            if (state.maxWaitMs !== undefined) {
                targetMaxWaitMs.current = state.maxWaitMs;
            }
            if (state.leaderIds) {
                setIsLeader(state.leaderIds.includes(messageId));
            }
        }
    }, [isGemini, channelId, messageId, status]);

    // Setup window event listeners for batch worker
    useEffect(() => {
        if (!isGemini) return;

        const firedName = getFiredEventName(channelId);
        const debouncedName = getDebouncedEventName(channelId);
        const pausedName = getPausedEventName(channelId);

        const firedHandler = (e: CustomEvent<{ taskIds?: string[] }>) => {
            if (!hasFired.current) {
                if (e.detail?.taskIds && !e.detail.taskIds.includes(messageId)) return;
                hasFired.current = true;
                globalProgressStore.reset();
                setStatus("fired");
            }
        };

        const debouncedHandler = (e: CustomEvent<BatGeminiEventDetail>) => {
            if (!hasFired.current) {
                isPaused.current = false;
                if (e.detail) {
                    if (e.detail.leaderIds) {
                        setIsLeader(e.detail.leaderIds.includes(messageId));
                    }
                    if (e.detail.deadline !== undefined) {
                        targetDeadline.current = e.detail.deadline;
                    }
                    if (e.detail.ecoProgress !== undefined) {
                        targetEcoProgress.current = e.detail.ecoProgress;
                    }
                    if (e.detail.startTime !== undefined) {
                        targetStartTime.current = e.detail.startTime;
                    }
                    if (e.detail.maxWaitMs !== undefined) {
                        targetMaxWaitMs.current = e.detail.maxWaitMs;
                    }
                }
            }
        };

        const pausedHandler = (e: CustomEvent<BatGeminiEventDetail>) => {
            if (!hasFired.current) {
                isPaused.current = true;
                if (e.detail && e.detail.leaderIds) {
                    setIsLeader(e.detail.leaderIds.includes(messageId));
                }
            }
        };

        window.addEventListener(firedName, firedHandler as EventListener);
        window.addEventListener(debouncedName, debouncedHandler as EventListener);
        window.addEventListener(pausedName, pausedHandler as EventListener);

        return () => {
            window.removeEventListener(firedName, firedHandler as EventListener);
            window.removeEventListener(debouncedName, debouncedHandler as EventListener);
            window.removeEventListener(pausedName, pausedHandler as EventListener);
        };
    }, [isGemini, channelId, messageId]);

    return {
        hasFired,
        status,
        isLeader,
        isPaused,
        targetDeadline,
        targetEcoProgress,
        targetStartTime,
        targetMaxWaitMs
    };
}
