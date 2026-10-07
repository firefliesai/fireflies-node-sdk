/**
 * Rate-limit awareness for the Fireflies GraphQL API.
 *
 * Every response from api.fireflies.ai carries the state of the caller's quota:
 *
 *   X-RateLimit-Limit      size of the primary window (daily quota on Free/Pro,
 *                          per-minute limit on Business/Enterprise)
 *   X-RateLimit-Remaining  requests left in that window
 *   X-RateLimit-Reset      seconds until that window resets
 *   Retry-After            on a 429 only: seconds to wait before retrying
 *
 * The same three values are repeated once per window with a suffix
 * (`X-RateLimit-*-api`, `X-RateLimit-*-api_burst`, ...). A rejected request is
 * either an HTTP 429 or a GraphQL error whose `extensions.code` is
 * `too_many_requests`; its `extensions.metadata.retryAfter` is an epoch
 * timestamp in MILLISECONDS (not seconds).
 *
 * Plan limits: https://docs.fireflies.ai/fundamentals/limits
 */

export const TOO_MANY_REQUESTS_CODE = 'too_many_requests';

/** One rate-limit window as reported by a `X-RateLimit-*[-suffix]` header triple. */
export interface RateLimitWindow {
  /** Window name: `default` for the unsuffixed headers, else the suffix (`api`, `api_burst`, ...). */
  name: string;
  /** Size of the window, or `null` when the header was absent. */
  limit: number | null;
  /** Requests left in the window, or `null` when the header was absent. */
  remaining: number | null;
  /** Seconds until the window resets, or `null` when the header was absent. */
  reset: number | null;
}

/** Parsed rate-limit state of the most recent response. */
export interface RateLimitState {
  /** `X-RateLimit-Limit` (the primary window; on a 429 the window that rejected the request). */
  limit: number | null;
  /** `X-RateLimit-Remaining`. */
  remaining: number | null;
  /** `X-RateLimit-Reset`, in seconds. */
  reset: number | null;
  /** `Retry-After` in seconds; only present on a rejected request. */
  retryAfter: number | null;
  /** Every window the response described, keyed by window name (`default`, `api`, `api_burst`, ...). */
  windows: Record<string, RateLimitWindow>;
  /** `Date.now()` when the response was received. */
  observedAt: number;
}

/** Options for the automatic retry of rate-limited requests. */
export interface RateLimitRetryOptions {
  /**
   * How many times a rate-limited request is retried before the error is surfaced.
   * `0` disables retries. Default: 3.
   */
  maxRetries?: number;
  /**
   * Longest wait the SDK will accept before a retry, in milliseconds. A
   * `Retry-After` beyond this (for example an exhausted daily quota that resets
   * at midnight UTC) is surfaced immediately instead of blocking the process.
   * Default: 65 000 (one per-minute window plus margin).
   */
  maxRetryWaitMs?: number;
  /** Called before every wait with the computed delay. Useful for logging. */
  onRateLimited?: (info: RateLimitRetryInfo) => void;
}

export interface RateLimitRetryInfo {
  /** 1-based number of the retry about to happen. */
  attempt: number;
  /** Milliseconds the SDK is about to wait. */
  waitMs: number;
  /** Rate-limit state parsed from the rejected response. */
  rateLimit: RateLimitState | null;
}

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_RETRY_WAIT_MS = 65_000;
/** Used when a rejection carries neither `Retry-After` nor `metadata.retryAfter`. */
const FALLBACK_RETRY_DELAY_MS = 1_000;

/**
 * Error thrown when a request is still rate limited after every retry (or when
 * the server asked for a longer wait than `maxRetryWaitMs` allows).
 *
 * The message keeps the `Fireflies API Error:` prefix so existing
 * `error.message.includes('API Error')` checks keep working.
 */
export class FirefliesRateLimitError extends Error {
  /** Seconds to wait before retrying, as the server reported it. `null` if it did not say. */
  readonly retryAfter: number | null;
  /** Absolute time at which a retry is allowed, or `null` when unknown. */
  readonly retryAt: Date | null;
  /** Rate-limit state parsed from the rejected response. */
  readonly rateLimit: RateLimitState | null;
  /** Number of attempts made, including the first one. */
  readonly attempts: number;
  readonly code = TOO_MANY_REQUESTS_CODE;

  constructor(params: {
    retryAfterMs: number | null;
    rateLimit: RateLimitState | null;
    attempts: number;
    serverMessage?: string;
  }) {
    const retryAfterSeconds =
      params.retryAfterMs === null ? null : Math.max(0, Math.ceil(params.retryAfterMs / 1000));
    const waitText =
      retryAfterSeconds === null ? 'retry later' : `retry after ${retryAfterSeconds} seconds`;
    super(
      `Fireflies API Error: rate limit exceeded (${TOO_MANY_REQUESTS_CODE}); ${waitText}` +
        (params.serverMessage ? `. ${params.serverMessage}` : '') +
        '. See https://docs.fireflies.ai/fundamentals/limits'
    );
    this.name = 'FirefliesRateLimitError';
    this.retryAfter = retryAfterSeconds;
    this.retryAt = params.retryAfterMs === null ? null : new Date(Date.now() + params.retryAfterMs);
    this.rateLimit = params.rateLimit;
    this.attempts = params.attempts;
    Object.setPrototypeOf(this, FirefliesRateLimitError.prototype);
  }
}

type HeaderValue = string | string[] | number | undefined | null;
type HeadersLike = Record<string, HeaderValue> | { [key: string]: unknown } | undefined | null;

function normalizeHeaders(headers: HeadersLike): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers || typeof headers !== 'object') return result;
  for (const key of Object.keys(headers)) {
    const value = (headers as Record<string, HeaderValue>)[key];
    if (value === undefined || value === null) continue;
    result[key.toLowerCase()] = Array.isArray(value) ? String(value[0]) : String(value);
  }
  return result;
}

function parseIntegerHeader(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const RATE_LIMIT_HEADER = /^x-ratelimit-(limit|remaining|reset)(?:-(.+))?$/;

/**
 * Parse the `X-RateLimit-*` headers of a response. Returns `null` when the
 * response carried none of them (an older API, a proxy that stripped them, ...).
 */
export function parseRateLimitHeaders(headers: HeadersLike, now: number = Date.now()): RateLimitState | null {
  const normalized = normalizeHeaders(headers);
  const windows: Record<string, RateLimitWindow> = {};

  for (const name of Object.keys(normalized)) {
    const match = RATE_LIMIT_HEADER.exec(name);
    if (!match) continue;
    const field = match[1] as 'limit' | 'remaining' | 'reset';
    const windowName = match[2] ?? 'default';
    const window = (windows[windowName] ??= { name: windowName, limit: null, remaining: null, reset: null });
    window[field] = parseIntegerHeader(normalized[name]);
  }

  const retryAfter = parseRetryAfterHeader(normalized['retry-after'], now);

  if (Object.keys(windows).length === 0 && retryAfter === null) return null;

  const primary = windows['default'];
  return {
    limit: primary?.limit ?? null,
    remaining: primary?.remaining ?? null,
    reset: primary?.reset ?? null,
    retryAfter,
    windows,
    observedAt: now
  };
}

/** `Retry-After` is either delay-seconds or an HTTP-date (RFC 9110 §10.2.3). Returns seconds. */
export function parseRetryAfterHeader(value: string | undefined, now: number = Date.now()): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, Math.ceil((asDate - now) / 1000));
}

interface GraphQLErrorLike {
  message?: string;
  code?: string;
  extensions?: {
    code?: string;
    metadata?: { retryAfter?: number };
    retryAfter?: number;
  };
}

/** Find the `too_many_requests` error in a GraphQL `errors` array, if any. */
export function findTooManyRequestsError(errors: unknown): GraphQLErrorLike | null {
  if (!Array.isArray(errors)) return null;
  for (const error of errors as GraphQLErrorLike[]) {
    if (!error || typeof error !== 'object') continue;
    if (error.extensions?.code === TOO_MANY_REQUESTS_CODE || error.code === TOO_MANY_REQUESTS_CODE) {
      return error;
    }
  }
  return null;
}

/**
 * How long to wait before retrying a rejected request, in milliseconds.
 *
 * Precedence: `Retry-After` header → `extensions.metadata.retryAfter` (epoch
 * ms) → `X-RateLimit-Reset` → a fixed fallback. Never negative.
 */
export function resolveRetryDelayMs(
  rateLimit: RateLimitState | null,
  error: GraphQLErrorLike | null,
  now: number = Date.now()
): number {
  if (rateLimit?.retryAfter !== null && rateLimit?.retryAfter !== undefined) {
    return Math.max(0, rateLimit.retryAfter * 1000);
  }
  const retryAt = error?.extensions?.metadata?.retryAfter ?? error?.extensions?.retryAfter;
  if (typeof retryAt === 'number' && Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - now);
  }
  if (rateLimit?.reset !== null && rateLimit?.reset !== undefined) {
    return Math.max(0, rateLimit.reset * 1000);
  }
  return FALLBACK_RETRY_DELAY_MS;
}

/** The window with the fewest requests left, or `null` when no window reports `remaining`. */
export function mostConstrainedWindow(state: RateLimitState | null): RateLimitWindow | null {
  if (!state) return null;
  let best: RateLimitWindow | null = null;
  for (const window of Object.values(state.windows)) {
    if (window.remaining === null) continue;
    if (best === null || window.remaining < (best.remaining as number)) best = window;
  }
  return best;
}

export interface PacerOptions {
  /** Requests sent concurrently per batch. Default: 5. */
  concurrency?: number;
  /** Pause between batches when the response carried no rate-limit headers. Default: 5 000 ms. */
  fallbackDelayMs?: number;
  /** Longest pause the pacer will take waiting for a window to reset. Default: 65 000 ms. */
  maxWaitMs?: number;
}

export interface PacerDecision {
  /** How many requests to send in the next batch. */
  batchSize: number;
  /** Milliseconds to wait before sending the next batch. */
  waitMs: number;
  /**
   * Why `waitMs` is what it is:
   * - `ok`: the window has room, send now;
   * - `no-headers`: nothing is known, `waitMs` is the fixed fallback pause
   *   (callers may skip it before the very first batch);
   * - `window-empty`: the constraining window has no requests left, `waitMs`
   *   is the time until it resets.
   */
  reason: 'ok' | 'no-headers' | 'window-empty';
  /**
   * `true` when the constraining window is empty and its reset is further away
   * than `maxWaitMs`: the caller should stop rather than block.
   */
  exhausted: boolean;
  /** Seconds until the constraining window resets, when known. */
  resetSeconds: number | null;
}

/**
 * Decides the size of the next batch and the pause before it from the latest
 * rate-limit state. With no state at all it falls back to the historical
 * fixed schedule (`concurrency` requests, then `fallbackDelayMs`).
 */
export class RateLimitPacer {
  readonly concurrency: number;
  readonly fallbackDelayMs: number;
  readonly maxWaitMs: number;

  constructor(options: PacerOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 5);
    this.fallbackDelayMs = Math.max(0, options.fallbackDelayMs ?? 5_000);
    this.maxWaitMs = Math.max(0, options.maxWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS);
  }

  /**
   * @param state     latest parsed rate-limit state (`null` when none was ever seen)
   * @param pending   number of requests still to send
   * @param now       clock, injectable for tests
   */
  next(state: RateLimitState | null, pending: number, now: number = Date.now()): PacerDecision {
    const batchCap = Math.min(this.concurrency, Math.max(0, pending));
    if (pending <= 0) return { batchSize: 0, waitMs: 0, reason: 'ok', exhausted: false, resetSeconds: null };

    const window = mostConstrainedWindow(state);
    if (!window || !state) {
      // No headers: keep the old "N requests, then a fixed pause" schedule.
      return { batchSize: batchCap, waitMs: this.fallbackDelayMs, reason: 'no-headers', exhausted: false, resetSeconds: null };
    }

    // The headers were read some time ago; the window may have moved on since.
    const elapsedSeconds = Math.floor((now - state.observedAt) / 1000);
    const resetSeconds = window.reset === null ? null : Math.max(0, window.reset - elapsedSeconds);
    const remaining = window.remaining as number;

    if (remaining > 0) {
      return { batchSize: Math.min(batchCap, remaining), waitMs: 0, reason: 'ok', exhausted: false, resetSeconds };
    }

    // Window empty: wait for it to reset (plus a small margin), unless that is too long.
    const waitMs = resetSeconds === null ? this.fallbackDelayMs : resetSeconds * 1000 + 500;
    if (waitMs > this.maxWaitMs) {
      return { batchSize: 0, waitMs, reason: 'window-empty', exhausted: true, resetSeconds };
    }
    // Once the window has reset the full batch fits again.
    return { batchSize: batchCap, waitMs, reason: 'window-empty', exhausted: false, resetSeconds };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
