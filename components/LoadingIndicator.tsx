/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useRef } from "@webpack/common";

import { useEcoModeEvents } from "../hooks/useEcoModeEvents";
import { useProgressAnimation } from "../hooks/useProgressAnimation";
import { settings } from "../settings";

interface LoadingIndicatorProps {
    displayColor?: string;
    topMargin: number;
    hideOriginal: boolean;
    showSeparator: boolean;
    messageId: string;
    channelId: string;
}

export const LoadingIndicator = ErrorBoundary.wrap(function LoadingIndicator({
    displayColor,
    topMargin,
    hideOriginal,
    showSeparator,
    messageId,
    channelId
}: LoadingIndicatorProps) {
    const circleRef = useRef<SVGCircleElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const countRef = useRef<HTMLSpanElement>(null);

    const { APIEcoModeThreshold } = settings.use(["APIEcoModeThreshold"]);

    // 1. Hook to manage window events for AI batch state
    const {
        hasFired,
        status,
        isLeader,
        isPaused,
        paused,
        targetDeadline,
        targetEcoProgress,
        targetStartTime,
        targetMaxWaitMs
    } = useEcoModeEvents({ channelId, messageId });

    // 2. Hook to run the rAF loop and sync progress
    const { currentProgressRef } = useProgressAnimation({
        channelId, paused, threshold: APIEcoModeThreshold ?? 1, circleRef, svgRef, countRef,
        status,
        isLeader,
        isPaused,
        hasFired,
        targetDeadline,
        targetEcoProgress,
        targetStartTime,
        targetMaxWaitMs
    });

    return (
        <div className="bat-translation" style={{ color: displayColor, marginTop: topMargin }}>
            {(!hideOriginal && showSeparator) && <div className="bat-separator" />}

            <div className="bat-loading-wrapper">
                {(status === "fired") ? (
                    <div className="bat-loading-dots">
                        <div className="bat-dot" />
                        <div className="bat-dot" />
                        <div className="bat-dot" />
                    </div>
                ) : (!isLeader) ? (
                    <div className="bat-loading-dots bat-loading-dots-static">
                        <div className="bat-dot" />
                        <div className="bat-dot" />
                        <div className="bat-dot" />
                    </div>
                ) : (
                    <>
                        <svg ref={svgRef} className="bat-claude-ring" viewBox="0 0 16 16">
                            <circle className="bat-claude-ring-track" cx="8" cy="8" r="6" />
                            <circle
                                ref={circleRef}
                                className="bat-claude-ring-fill"
                                cx="8" cy="8" r="6"
                                style={{
                                    strokeDasharray: "38",
                                    strokeDashoffset: (38 * (1 - currentProgressRef.current)).toString()
                                }}
                            />
                        </svg>
                        <span ref={countRef} hidden className="bat-loading-count" />
                    </>
                )}
            </div>
        </div>
    );
}, { noop: true });
