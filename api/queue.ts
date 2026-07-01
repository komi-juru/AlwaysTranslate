/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CONCURRENCY_LIMIT, QUEUE_TTL } from "../constants";

export interface QueueItem {
    resolve: (value: any) => void;
    reject: (e: Error) => void;
    fn: () => Promise<any>;
    timestamp: number;
}

/**
 * Concurrency-limited translation queue.
 * Encapsulates mutable state so it can be properly reset on plugin stop.
 */
export class TranslationQueue {
    private activeRequests = 0;
    private queue: QueueItem[] = [];
    private readonly limit: number;

    constructor(limit = CONCURRENCY_LIMIT) {
        this.limit = limit;
    }

    get isBusy(): boolean {
        return this.activeRequests > 0;
    }

    async enqueue<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ resolve, reject, fn, timestamp: Date.now() });
            this.pump();
        });
    }

    private pump() {
        if (this.activeRequests >= this.limit || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift()!;

        if (Date.now() - item.timestamp > QUEUE_TTL) {
            item.reject(new Error(`Translation task timed out (TTL ${QUEUE_TTL}ms)`));
            queueMicrotask(() => this.pump());
            return;
        }

        this.activeRequests++;

        item.fn()
            .then(item.resolve)
            .catch(item.reject)
            .finally(() => {
                this.activeRequests--;
                queueMicrotask(() => this.pump());
            });

        if (this.activeRequests < this.limit && this.queue.length > 0) {
            queueMicrotask(() => this.pump());
        }
    }

    /** Reset queue state. Call on plugin disable. */
    reset() {
        this.activeRequests = 0;
        this.queue.forEach(item => item.reject(new Error("Queue reset")));
        this.queue.length = 0;
    }
}

/** Singleton queue instance for standard translation engines (DeepL) */
export const translationQueue = new TranslationQueue(CONCURRENCY_LIMIT);
