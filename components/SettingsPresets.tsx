/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { reScheduleAllWorkers } from "../api/translate";
import { settings } from "../settings";

const presets = [
    { name: "Real-time", threshold: 1, wait: 0, description: "Translate as messages arrive." },
    { name: "Balanced", threshold: 3, wait: 10, description: "3 messages or 10 seconds." },
    { name: "Economy", threshold: 10, wait: 30, description: "10 messages or 30 seconds." },
    { name: "Sleep", threshold: 250, wait: 0, description: "Wait for 250 messages. No time limit." }
];

export function SettingsPresets() {
    const { APIEcoModeThreshold: threshold, APIMaxBatchWait: wait } = settings.use(["APIEcoModeThreshold", "APIMaxBatchWait"]);
    const current = presets.find(p => p.threshold === threshold && p.wait === wait);
    const update = (count: number, seconds: number) => {
        settings.store.APIEcoModeThreshold = count;
        settings.store.APIMaxBatchWait = seconds;
        reScheduleAllWorkers();
    };

    return (
        <section className="bat-settings-section" aria-label="Eco mode">
            <h3>Translation timing <span className="bat-settings-badge">{current?.name || "Custom"}</span></h3>
            <p className="bat-settings-description">Group messages to reduce Gemini and DeepSeek requests. DeepL uses its own batching. Translate Now sends queued messages immediately.</p>
            <div className="bat-settings-presets">
                {presets.map(p => (
                    <button type="button" key={p.name} className="bat-settings-preset" aria-pressed={current === p} onClick={() => update(p.threshold, p.wait)}>
                        <strong>{p.name}</strong><span>{p.description}</span>
                    </button>
                ))}
            </div>
            <details className="bat-settings-details">
                <summary>Custom timing · {threshold} messages / {wait === 0 ? "no time limit" : `${wait}s`}</summary>
                <div className="bat-settings-fields">
                    <label>Message threshold
                        <input type="number" min={1} max={1000} step={1} value={threshold} onChange={e => {
                            const value = e.currentTarget.valueAsNumber;
                            if (Number.isInteger(value) && value >= 1 && value <= 1000) update(value, wait);
                        }} />
                    </label>
                    <label>Maximum wait (seconds)
                        <input type="number" min={0} max={300} step={1} value={wait} onChange={e => {
                            const value = e.currentTarget.valueAsNumber;
                            if (Number.isInteger(value) && value >= 0 && value <= 300) update(threshold, value);
                        }} />
                    </label>
                </div>
                <p className="bat-settings-description">0 seconds means no time limit. Translation starts when the message threshold is reached or you use Translate Now.</p>
            </details>
        </section>
    );
}
