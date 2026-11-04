/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef } from "@webpack/common";

import { BATCH_ACCUMULATION_TIME_GEMINI } from "../constants";
import { globalProgressStore } from "../utils/progressStore";

interface UseProgressAnimationProps {
    channelId: string;
    paused: boolean;
    threshold: number;
    circleRef: React.RefObject<SVGCircleElement | null>;
    svgRef: React.RefObject<SVGSVGElement | null>;
    countRef: React.RefObject<HTMLSpanElement | null>;
    status: "waiting" | "fired";
    isLeader: boolean;
    isPaused: React.MutableRefObject<boolean>;
    hasFired: React.MutableRefObject<boolean>;
    targetDeadline: React.MutableRefObject<number>;
    targetEcoProgress: React.MutableRefObject<number>;
    targetStartTime: React.MutableRefObject<number>;
    targetMaxWaitMs: React.MutableRefObject<number>;
}

export function useProgressAnimation({
    channelId,
    paused,
    threshold,
    circleRef,
    svgRef,
    countRef,
    status,
    isLeader,
    isPaused,
    hasFired,
    targetDeadline,
    targetEcoProgress,
    targetStartTime,
    targetMaxWaitMs
}: UseProgressAnimationProps) {
    const progressStartVal = useRef<number>(globalProgressStore.get(channelId));
    const progressStartTime = useRef<number>(Date.now());
    const currentProgressRef = useRef<number>(globalProgressStore.get(channelId));
    const wasCountdown = useRef<boolean>(false);

    useEffect(() => {
        const draw = () => {
            if (circleRef.current) circleRef.current.style.strokeDashoffset = (38 * (1 - currentProgressRef.current)).toFixed(3);
            if (svgRef.current) svgRef.current.style.opacity = paused ? "0.5" : "1";
            if (countRef.current) {
                const hidden = threshold <= 1 || targetEcoProgress.current >= 1;
                countRef.current.hidden = hidden;
                if (!hidden) {
                    const label = Math.round(targetEcoProgress.current * threshold) + "/" + threshold;
                    if (countRef.current.textContent !== label) countRef.current.textContent = label;
                }
            }
        };
        draw();
        if (status === "fired" || !isLeader || paused) return;

        let animationFrameId: number;

        const updateRing = () => {
            if (hasFired.current || isPaused.current) return;

            if (!isPaused.current) {
                const now = Date.now();
                // 임계값 달성 후 카운트다운 모드: deadline이 유한하고 ecoProgress가 꽉 참
                const isCountdown = targetEcoProgress.current >= 1 && targetDeadline.current !== Infinity;

                if (isCountdown) {
                    const remaining = Math.max(0, targetDeadline.current - now);
                    const expectedProgress = remaining / BATCH_ACCUMULATION_TIME_GEMINI;

                    if (!wasCountdown.current) {
                        wasCountdown.current = true;
                        // Only jump to 1 if we are starting fresh (not continuing a previous leader's countdown)
                        if (currentProgressRef.current < expectedProgress - 0.1) {
                            currentProgressRef.current = 1;
                        }
                    }

                    const targetProgress = expectedProgress;

                    // Smooth physics trailing (0.15) for normal operation and reset jumps.
                    // But in the final 200ms, gradually stiffen the easing factor up to 1.0
                    // to guarantee a mathematically perfect landing at exactly 0.0 when remaining hits 0.
                    let easeFactor = 0.15;
                    if (remaining <= 200) {
                        const ratio = 1 - (remaining / 200);
                        easeFactor = 0.15 + (0.85 * ratio);
                    }

                    currentProgressRef.current += (targetProgress - currentProgressRef.current) * easeFactor;
                } else if (targetMaxWaitMs.current > 0 && targetEcoProgress.current < 1) {
                    // Max Wait 켜져있는 에코 모드 (시간과 개수 중 더 많이 찬 것을 따라감)
                    wasCountdown.current = false;
                    const elapsed = Math.max(0, now - targetStartTime.current);
                    const timeProgress = Math.min(1, elapsed / targetMaxWaitMs.current);
                    const targetProgress = Math.max(targetEcoProgress.current, timeProgress);
                    currentProgressRef.current += (targetProgress - currentProgressRef.current) * 0.1;
                } else if (targetDeadline.current === Infinity) {
                    // 에코 채우기 모드 (Max Wait 없음)
                    wasCountdown.current = false;
                    currentProgressRef.current += (targetEcoProgress.current - currentProgressRef.current) * 0.1;
                } else {
                    // 시간 기반 채우기 모드 (ecoThreshold=1)
                    wasCountdown.current = false;
                    const totalTime = targetDeadline.current - progressStartTime.current;
                    if (now >= targetDeadline.current || totalTime <= 0) {
                        currentProgressRef.current = 1;
                    } else {
                        const ratio = (now - progressStartTime.current) / totalTime;
                        const timeProgress = progressStartVal.current + (1 - progressStartVal.current) * ratio;
                        const targetProgress = Math.max(targetEcoProgress.current, timeProgress);
                        currentProgressRef.current += (targetProgress - currentProgressRef.current) * 0.1;
                    }
                }

                currentProgressRef.current = Math.max(0, Math.min(1, currentProgressRef.current));
            }

            if (isLeader) {
                globalProgressStore.set(channelId, currentProgressRef.current);
            }

            draw();

            animationFrameId = requestAnimationFrame(updateRing);
        };

        animationFrameId = requestAnimationFrame(updateRing);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [channelId, paused, threshold, status, isLeader, hasFired, isPaused, targetDeadline, targetEcoProgress, targetStartTime, targetMaxWaitMs, circleRef, svgRef, countRef]);

    return {
        currentProgressRef
    };
}
