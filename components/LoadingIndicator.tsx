/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useRef } from "@webpack/common";

import { useEcoModeEvents } from "../hooks/useEcoModeEvents";
import { useProgressAnimation } from "../hooks/useProgressAnimation";
import { settings } from "../settings";

interface LoadingIndicatorProps {
    displayColor?: string;
    topMargin: number;
    hideOriginal: boolean;
    showSeparator: boolean;
    isGemini: boolean;
    messageId: string;
    channelId: string;
}

export function LoadingIndicator({
    displayColor,
    topMargin,
    hideOriginal,
    showSeparator,
    isGemini,
    messageId,
    channelId
}: LoadingIndicatorProps) {
    const circleRef = useRef<SVGCircleElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const { APIEcoModeThreshold } = settings.use(["APIEcoModeThreshold"]);

    // 1. Hook to manage window events for Gemini batch state
    const {
        hasFired,
        status,
        isLeader,
        isPaused,
        targetDeadline,
        targetEcoProgress,
        targetStartTime,
        targetMaxWaitMs
    } = useEcoModeEvents({ isGemini, channelId, messageId });

    // 2. Hook to run the rAF loop and sync progress
    const { currentProgressRef } = useProgressAnimation({
        isGemini,
        status,
        isLeader,
        isPaused,
        hasFired,
        targetDeadline,
        targetEcoProgress,
        targetStartTime,
        targetMaxWaitMs
    });

    // 3. Direct DOM manipulation for high-performance animation
    // The useProgressAnimation hook triggers a re-render every frame to sync this.
    if (circleRef.current && svgRef.current) {
        const currentProgress = currentProgressRef.current;
        const offset = 38 * (1 - currentProgress);
        circleRef.current.style.strokeDashoffset = offset.toString();
        svgRef.current.style.opacity = isPaused.current ? "0.5" : "1";
    }

    return (
        <div className="bat-translation" style={{ color: displayColor, marginTop: topMargin }}>
            {(!hideOriginal && showSeparator) && <div className="bat-separator" />}

            <div className="bat-loading-wrapper">
                {(!isGemini || status === "fired") ? (
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
                        {(() => {
                            const threshold = APIEcoModeThreshold ?? 1;
                            if (threshold <= 1) return null;
                            if (targetEcoProgress.current >= 1) return null;
                            const count = Math.round(targetEcoProgress.current * threshold);
                            return (
                                <span style={{ fontSize: "10px", opacity: 0.6, marginLeft: "4px", fontFamily: "monospace", userSelect: "none" }}>
                                    {count}/{threshold}
                                </span>
                            );
                        })()}
                    </>
                )}
            </div>
        </div>
    );
}
