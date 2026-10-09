import { TranscriptData } from './types';
import { FirefliesSDK } from './fireflies';
import { PacerOptions, RateLimitPacer, RateLimitState } from './rate-limit';

export function generateGraphQLFilter(fields: string[]): string {
    return fields.join(" ");
}

// const fields = ["id", "dateString", "privacy", "speakers { id name }"];

export interface BatchProcessResult {
    meetings: TranscriptData[];
    errors: string[];
}

/** Anything that exposes the latest parsed rate-limit state — a `FirefliesSDK` instance does. */
export interface RateLimitSource {
    readonly rateLimit: RateLimitState | null;
}

export interface BatchProcessOptions extends PacerOptions {
    /**
     * Where to read `X-RateLimit-*` state from between batches (pass the
     * `FirefliesSDK` the tasks use). Without it, or while the API sends no
     * headers, the helper falls back to the fixed schedule of `concurrency`
     * requests followed by a `fallbackDelayMs` pause.
     */
    rateLimitSource?: RateLimitSource;
    /**
     * Name used for this key in progress logs (e.g. `key #2`). Never derived
     * from the API key itself: no part of a credential belongs in a log line.
     */
    label?: string;
}

export class MeetingsHelper {
    private static CONCURRENCY_LIMIT = 5;
    private static DELAY_TIME = 5000;

    private static async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Run `tasks` in batches, pacing from the rate-limit headers of the previous
     * batch when a `rateLimitSource` is given: the next batch is shrunk to the
     * requests left in the most constrained window, and an empty window is waited
     * out (up to `maxWaitMs`) instead of sleeping a fixed 5 s. When the wait would
     * exceed `maxWaitMs` (for example an exhausted daily quota) processing stops
     * and the remaining tasks are reported as a single error.
     */
    static async batchProcess(
        tasks: (() => Promise<any>)[],
        // Kept for signature compatibility; not used for anything (see `label`).
        _apiKey: string,
        options: BatchProcessOptions = {}
    ): Promise<BatchProcessResult> {
        let index = 0;
        const results: TranscriptData[] = [];
        const errors: string[] = [];
        const pacer = new RateLimitPacer({
            concurrency: options.concurrency ?? MeetingsHelper.CONCURRENCY_LIMIT,
            fallbackDelayMs: options.fallbackDelayMs ?? MeetingsHelper.DELAY_TIME,
            maxWaitMs: options.maxWaitMs
        });
        // Progress lines name the key by a caller-supplied label, never by any
        // fragment of the credential itself.
        const keyLabel = options.label ?? 'api key';

        while (index < tasks.length) {
            const decision = pacer.next(options.rateLimitSource?.rateLimit ?? null, tasks.length - index);

            if (decision.exhausted) {
                const pending = tasks.length - index;
                const resetText = decision.resetSeconds === null ? 'later' : `in ${decision.resetSeconds}s`;
                console.warn(
                    `Rate limit exhausted for apiKey: ${keyLabel}; window resets ${resetText}. ` +
                    `Skipping ${pending} remaining request(s).`
                );
                errors.push(`Rate limit exhausted; ${pending} request(s) not sent, window resets ${resetText}`);
                break;
            }

            // Pause before the batch: always when the window is empty, and between
            // batches (never before the first) when the API sends no headers.
            if (decision.waitMs > 0 && (decision.reason === 'window-empty' || index > 0)) {
                await MeetingsHelper.delay(decision.waitMs);
            }

            const end = Math.min(index + decision.batchSize, tasks.length);
            console.log(
                `Processing ${index} to ${end} of ${tasks.length} for apiKey: ${keyLabel}`
            );

            const currentBatch = tasks.slice(index, end).map(task => {
                return task().catch(e => {
                    console.error(`Error processing task at index ${index}: ${e}`);
                    return { errors: [{ code: e.message }] };
                });
            });

            const batchResults = await Promise.all(currentBatch);
            batchResults.forEach(result => {
                if (result?.errors) {
                    errors.push(result.errors[0]?.code);
                } else if (result?.data?.transcript) {
                    results.push(result.data.transcript);
                }
            });

            index = end;
        }

        return { meetings: results, errors };
    }

    static async getAllMeetingIds(sdk: FirefliesSDK): Promise<string[]> {
        let skip = 0;
        const limit = 50;
        let hasMore = true;
        let allItems: TranscriptData[] = [];

        while (hasMore) {
            try {
                const items = await sdk.getTranscripts({ limit, skip }, ['id']);

                if (items) {
                    allItems = allItems.concat(items);
                }

                if (!items || items.length < limit) {
                    hasMore = false;
                } else {
                    skip += limit;
                }
            } catch (error) {
                if (error instanceof Error) {
                    console.error("An error occurred while fetching items:", error.message);
                }
                throw error;
            }
        }

        return allItems.map(item => item.id);
    }

    /**
     * @param apiKeys  keys to list meetings for
     * @param clients  optional `FirefliesSDK` per key to reuse (so the rate-limit
     *                 state these listing calls produce is available afterwards);
     *                 a key without one gets a fresh client
     */
    static async getDedeuplicatedMeetingIds(
        apiKeys: string[],
        clients: { [key: string]: FirefliesSDK } = {}
    ): Promise<{ [key: string]: string[] }> {
        const allItems: { [key: string]: string[] } = {};
        const uniqueItems = new Set<string>();

        for (const apiKey of apiKeys) {
            const sdk = clients[apiKey] ?? new FirefliesSDK({ apiKey });
            const items = await MeetingsHelper.getAllMeetingIds(sdk);
            allItems[apiKey] = items;
            items.forEach(item => uniqueItems.add(item));
        }

        console.log(`Found unique meetings: ${uniqueItems.size}`);

        const deduplicatedItems = Array.from(uniqueItems);
        const result: { [key: string]: string[] } = {};
        const assignedItems = new Set<string>();

        for (const apiKey of apiKeys) {
            result[apiKey] = deduplicatedItems.filter(item => {
                const isInCurrentApiKey = allItems[apiKey].includes(item);
                const isAlreadyAssigned = assignedItems.has(item);
                if (isInCurrentApiKey && !isAlreadyAssigned) {
                    assignedItems.add(item);
                    return true;
                }
                return false;
            });
        }

        return result;
    }

    static async handleOutput(
        result: BatchProcessResult,
        apiKey: string,
        outputType: 'console' | 'json'
    ): Promise<void> {
        if (outputType === 'json') {
            try {
                const fs = require('fs');
                fs.writeFileSync(
                    `RESULTS_${apiKey}.json`,
                    JSON.stringify(result.meetings, null, 2)
                );
                if (result.errors.length > 0) {
                    fs.writeFileSync(
                        `ERRORS_${apiKey}.json`,
                        JSON.stringify(result.errors, null, 2)
                    );
                }
            } catch (e) {
                console.error('Error writing to file:', e);
            }
        } else {
            console.log('Meetings:', result.meetings);
            console.log('Errors:', result.errors);
        }
    }
}