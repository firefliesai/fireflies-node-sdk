import {
  RateLimitPacer,
  RateLimitState,
  findTooManyRequestsError,
  mergeRateLimitState,
  mostConstrainedWindow,
  parseRateLimitHeaders,
  parseRetryAfterHeader,
  resolveRetryDelayMs
} from '../src/rate-limit';

const NOW = 1_800_000_000_000;

function state(windows: Record<string, { limit?: number; remaining: number; reset: number }>, observedAt = NOW): RateLimitState {
  const built: RateLimitState['windows'] = {};
  for (const [name, w] of Object.entries(windows)) {
    built[name] = { name, limit: w.limit ?? null, remaining: w.remaining, reset: w.reset };
  }
  const primary = built['default'];
  return {
    limit: primary?.limit ?? null,
    remaining: primary?.remaining ?? null,
    reset: primary?.reset ?? null,
    retryAfter: null,
    windows: built,
    observedAt
  };
}

describe('parseRateLimitHeaders', () => {
  it('returns null when no rate-limit headers are present', () => {
    expect(parseRateLimitHeaders({ 'content-type': 'application/json' })).toBeNull();
    expect(parseRateLimitHeaders(undefined)).toBeNull();
  });

  it('parses the unsuffixed headers case-insensitively', () => {
    const parsed = parseRateLimitHeaders(
      { 'X-RateLimit-Limit': '500', 'x-ratelimit-remaining': '42', 'X-RATELIMIT-RESET': '3600' },
      NOW
    );
    expect(parsed).toMatchObject({ limit: 500, remaining: 42, reset: 3600, retryAfter: null, observedAt: NOW });
    expect(parsed?.windows['default']).toEqual({ name: 'default', limit: 500, remaining: 42, reset: 3600 });
  });

  it('keeps every suffixed window separately', () => {
    const parsed = parseRateLimitHeaders({
      'x-ratelimit-limit': '500',
      'x-ratelimit-remaining': '400',
      'x-ratelimit-reset': '20000',
      'x-ratelimit-limit-api': '500',
      'x-ratelimit-remaining-api': '400',
      'x-ratelimit-reset-api': '20000',
      'x-ratelimit-limit-api_burst': '30',
      'x-ratelimit-remaining-api_burst': '2',
      'x-ratelimit-reset-api_burst': '41'
    });
    expect(Object.keys(parsed!.windows).sort()).toEqual(['api', 'api_burst', 'default']);
    expect(parsed!.windows['api_burst']).toEqual({ name: 'api_burst', limit: 30, remaining: 2, reset: 41 });
    expect(mostConstrainedWindow(parsed)?.name).toBe('api_burst');
  });

  it('parses Retry-After in seconds and as an HTTP date, and accepts array header values', () => {
    expect(parseRateLimitHeaders({ 'retry-after': ['17'] }, NOW)).toMatchObject({ retryAfter: 17, windows: {} });
    const inNinety = new Date(NOW + 90_000).toUTCString();
    expect(parseRetryAfterHeader(inNinety, NOW)).toBe(90);
    expect(parseRetryAfterHeader('garbage', NOW)).toBeNull();
    expect(parseRetryAfterHeader(undefined, NOW)).toBeNull();
  });

  it('ignores unparsable numeric values', () => {
    const parsed = parseRateLimitHeaders({ 'x-ratelimit-limit': 'abc', 'x-ratelimit-remaining': '3' });
    expect(parsed).toMatchObject({ limit: null, remaining: 3 });
  });
});

describe('findTooManyRequestsError', () => {
  it('matches extensions.code and top-level code', () => {
    expect(findTooManyRequestsError([{ message: 'x', extensions: { code: 'too_many_requests' } }])).not.toBeNull();
    expect(findTooManyRequestsError([{ message: 'x', code: 'too_many_requests' }])).not.toBeNull();
    expect(findTooManyRequestsError([{ message: 'x', extensions: { code: 'object_not_found' } }])).toBeNull();
    expect(findTooManyRequestsError(undefined)).toBeNull();
    expect(findTooManyRequestsError('nope')).toBeNull();
  });
});

describe('resolveRetryDelayMs', () => {
  it('prefers the Retry-After header', () => {
    const s = { ...state({ default: { remaining: 0, reset: 50 } }), retryAfter: 7 };
    expect(resolveRetryDelayMs(s, { extensions: { metadata: { retryAfter: NOW + 99_000 } } }, NOW)).toBe(7_000);
  });

  it('falls back to extensions.metadata.retryAfter, an epoch timestamp in milliseconds', () => {
    expect(resolveRetryDelayMs(null, { extensions: { metadata: { retryAfter: NOW + 12_345 } } }, NOW)).toBe(12_345);
    // A timestamp already in the past never yields a negative wait.
    expect(resolveRetryDelayMs(null, { extensions: { metadata: { retryAfter: NOW - 5_000 } } }, NOW)).toBe(0);
  });

  it('then falls back to X-RateLimit-Reset, then to a fixed delay', () => {
    expect(resolveRetryDelayMs(state({ default: { remaining: 0, reset: 9 } }), null, NOW)).toBe(9_000);
    expect(resolveRetryDelayMs(null, null, NOW)).toBe(1_000);
  });

  it('uses the reset of an exhausted SUFFIXED window when no unsuffixed reset is present', () => {
    // Only X-RateLimit-*-api_burst on the rejection, read 4 s ago.
    const s = state({ api_burst: { remaining: 0, reset: 30 } }, NOW - 4_000);
    expect(resolveRetryDelayMs(s, null, NOW)).toBe(26_000);
  });

  it('waits for the latest of several exhausted windows and prefers them over a non-empty primary one', () => {
    const s = state({
      default: { remaining: 400, reset: 20_000 },
      api_burst: { remaining: 0, reset: 12 },
      api: { remaining: 0, reset: 40 }
    });
    expect(resolveRetryDelayMs(s, null, NOW)).toBe(40_000);
  });
});

describe('mergeRateLimitState', () => {
  it('returns the new state when nothing was recorded before', () => {
    const next = state({ default: { remaining: 3, reset: 50 } });
    expect(mergeRateLimitState(null, next)).toBe(next);
  });

  it('keeps the lower remaining when a stale response from the same window arrives late', () => {
    // Response A (served second) reports 0 left and arrives first; response B
    // (served first) reports 4 left and arrives 200 ms later. Same window: the
    // 0 must survive.
    const first = state({ api_burst: { remaining: 0, reset: 42 } }, NOW);
    const late = state({ api_burst: { remaining: 4, reset: 42 } }, NOW + 200);
    const merged = mergeRateLimitState(first, late);
    expect(merged.windows['api_burst'].remaining).toBe(0);
    expect(merged.observedAt).toBe(NOW + 200);
  });

  it('takes the new count once the window has rolled over', () => {
    const before = state({ default: { remaining: 0, reset: 5 } }, NOW);
    const after = state({ default: { remaining: 29, reset: 60 } }, NOW + 6_000);
    expect(mergeRateLimitState(before, after).windows['default'].remaining).toBe(29);
    expect(mergeRateLimitState(before, after).remaining).toBe(29);
  });

  it('takes the new count when the previous window had already expired by the clock', () => {
    const before = state({ default: { remaining: 0, reset: 5 } }, NOW);
    const after = state({ default: { remaining: 3, reset: 4 } }, NOW + 7_000);
    expect(mergeRateLimitState(before, after).windows['default'].remaining).toBe(3);
  });

  it('merges window by window and carries over windows the new state does not mention, aged', () => {
    const before = state({ default: { remaining: 1, reset: 100 }, api_burst: { remaining: 0, reset: 30 } }, NOW);
    const after = state({ default: { remaining: 5, reset: 99 }, api: { remaining: 7, reset: 99 } }, NOW + 1_000);
    const merged = mergeRateLimitState(before, after);
    expect(merged.windows['default'].remaining).toBe(1);
    expect(merged.windows['api'].remaining).toBe(7);
    expect(merged.windows['api_burst']).toEqual({ name: 'api_burst', limit: null, remaining: 0, reset: 29 });
    expect(merged.remaining).toBe(1);
  });

  it('keeps the api windows when an addToLiveMeeting response reports only call_join', () => {
    const before = state({ api: { remaining: 400, reset: 3000 }, api_burst: { remaining: 25, reset: 40 } }, NOW);
    const after = state({ call_join: { remaining: 0, reset: 1150 } }, NOW + 2_000);
    const merged = mergeRateLimitState(before, after);
    expect(Object.keys(merged.windows).sort()).toEqual(['api', 'api_burst', 'call_join']);
    expect(merged.windows['api']).toMatchObject({ remaining: 400, reset: 2998 });
    expect(merged.windows['api_burst']).toMatchObject({ remaining: 25, reset: 38 });
  });

  it('drops a carried-over window once its reset has passed', () => {
    const before = state({ api_burst: { remaining: 0, reset: 5 } }, NOW);
    const after = state({ call_join: { remaining: 2, reset: 1000 } }, NOW + 6_000);
    expect(mergeRateLimitState(before, after).windows['api_burst']).toBeUndefined();
  });
});

describe('RateLimitPacer', () => {
  it('keeps the fixed schedule when no headers were ever seen', () => {
    const pacer = new RateLimitPacer({ concurrency: 5, fallbackDelayMs: 5_000 });
    expect(pacer.next(null, 12)).toEqual({
      batchSize: 5,
      waitMs: 5_000,
      reason: 'no-headers',
      exhausted: false,
      resetSeconds: null
    });
    expect(pacer.next(null, 2).batchSize).toBe(2);
    expect(pacer.next(null, 0).batchSize).toBe(0);
  });

  it('sends a full batch without pausing while the window has room', () => {
    const pacer = new RateLimitPacer({ concurrency: 5 });
    const decision = pacer.next(state({ default: { remaining: 400, reset: 100 } }), 12, NOW);
    expect(decision).toMatchObject({ batchSize: 5, waitMs: 0, reason: 'ok', exhausted: false });
  });

  it('shrinks the batch to the most constrained window', () => {
    const pacer = new RateLimitPacer({ concurrency: 5 });
    const s = state({ default: { remaining: 400, reset: 100 }, api_burst: { remaining: 2, reset: 30 } });
    expect(pacer.next(s, 12, NOW)).toMatchObject({ batchSize: 2, waitMs: 0, reason: 'ok', resetSeconds: 30 });
  });

  it('waits for an empty window to reset, discounting time already elapsed', () => {
    const pacer = new RateLimitPacer({ concurrency: 5 });
    const s = state({ api_burst: { remaining: 0, reset: 10 } }, NOW - 4_000);
    expect(pacer.next(s, 12, NOW)).toEqual({
      batchSize: 5,
      waitMs: 6_500,
      reason: 'window-empty',
      exhausted: false,
      resetSeconds: 6
    });
  });

  it('caps the batch by a window that will NOT have reset once the empty one reopens', () => {
    // Burst empty, back in 3 s; daily has 2 left and resets tomorrow. After the
    // 3.5 s wait the burst window is full again but the day still only has 2.
    const pacer = new RateLimitPacer({ concurrency: 5 });
    const s = state({ api_burst: { remaining: 0, reset: 3 }, default: { remaining: 2, reset: 86_400 } });
    expect(pacer.next(s, 12, NOW)).toEqual({
      batchSize: 2,
      waitMs: 3_500,
      reason: 'window-empty',
      exhausted: false,
      resetSeconds: 3
    });
  });

  it('waits for the latest of several empty windows', () => {
    const pacer = new RateLimitPacer({ concurrency: 5 });
    const s = state({ api_burst: { remaining: 0, reset: 3 }, api: { remaining: 0, reset: 10 } });
    expect(pacer.next(s, 12, NOW)).toMatchObject({ batchSize: 5, waitMs: 10_500, resetSeconds: 10 });
  });

  it('ignores endpoint-specific windows such as call_join', () => {
    // The last call on this client was the third addToLiveMeeting in 20 min:
    // call_join is empty for ~19 min, but the api quota is fine.
    const pacer = new RateLimitPacer({ concurrency: 5, maxWaitMs: 65_000 });
    const s = state({ call_join: { remaining: 0, reset: 1150 }, api: { remaining: 400, reset: 3000 } });
    expect(pacer.next(s, 12, NOW)).toEqual({ batchSize: 5, waitMs: 0, reason: 'ok', exhausted: false, resetSeconds: 3000 });
  });

  it('falls back to the fixed schedule when only endpoint-specific windows are known', () => {
    const pacer = new RateLimitPacer({ concurrency: 5, fallbackDelayMs: 5_000 });
    const s = state({ call_join: { remaining: 0, reset: 1150 } });
    expect(pacer.next(s, 12, NOW)).toMatchObject({ batchSize: 5, waitMs: 5_000, reason: 'no-headers', exhausted: false });
  });

  it('reports exhaustion instead of blocking when the reset is beyond maxWaitMs', () => {
    const pacer = new RateLimitPacer({ concurrency: 5, maxWaitMs: 65_000 });
    const s = state({ default: { remaining: 0, reset: 3_600 } });
    expect(pacer.next(s, 12, NOW)).toMatchObject({ batchSize: 0, exhausted: true, resetSeconds: 3_600 });
  });
});
