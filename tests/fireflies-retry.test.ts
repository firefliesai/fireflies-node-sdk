import axios, { AxiosAdapter, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { FirefliesSDK } from '../src/fireflies';
import { FirefliesRateLimitError } from '../src/rate-limit';

interface ScriptedResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  /** Simulated network latency before the response completes (fake-timer ms). */
  delayMs?: number;
}

const NOW = 1_800_000_000_000;

/**
 * Replace axios' transport with a scripted adapter. The SDK still runs the real
 * axios request/response pipeline (status handling, isAxiosError, headers).
 */
function installTransport(script: ScriptedResponse[]) {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async config => {
    requests.push(config);
    const step = script.shift();
    if (!step) throw new Error(`Unexpected request #${requests.length}`);
    if (step.delayMs) await new Promise(resolve => setTimeout(resolve, step.delayMs));
    const response: AxiosResponse = {
      data: step.body,
      status: step.status,
      statusText: String(step.status),
      headers: step.headers ?? {},
      config,
      request: {}
    };
    if (step.status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${step.status}`,
        step.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        config,
        {},
        response
      );
    }
    return response;
  };
  const realCreate = axios.create.bind(axios);
  jest.spyOn(axios, 'create').mockImplementation(config => realCreate({ ...config, adapter }));
  return requests;
}

const ok = (headers?: Record<string, string>): ScriptedResponse => ({
  status: 200,
  headers,
  body: { data: { transcript: { id: 'abc', title: 'Standup' } } }
});

const tooManyBody = (retryAt: number) => ({
  errors: [
    {
      message: 'Too many requests. Please retry after Thu, 01 Jan 2027 00:00:00 GMT (UTC)',
      code: 'too_many_requests',
      extensions: { code: 'too_many_requests', status: 429, metadata: { retryAfter: retryAt } }
    }
  ],
  data: null
});

/** Start the call, then let fake timers run `ms` so pending sleeps resolve. */
async function settle<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Attach a handler first so a rejection is never "unhandled" while timers advance.
  const guarded = promise.catch(error => ({ __rejected: error }));
  await jest.advanceTimersByTimeAsync(ms);
  const outcome = await guarded;
  if (outcome && typeof outcome === 'object' && '__rejected' in (outcome as object)) {
    throw (outcome as { __rejected: unknown }).__rejected;
  }
  return outcome as T;
}

describe('FirefliesSDK rate-limit handling', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('exposes the parsed X-RateLimit-* state of the last response', async () => {
    installTransport([
      ok({
        'X-RateLimit-Limit': '500',
        'X-RateLimit-Remaining': '499',
        'X-RateLimit-Reset': '3600',
        'X-RateLimit-Limit-api_burst': '30',
        'X-RateLimit-Remaining-api_burst': '29',
        'X-RateLimit-Reset-api_burst': '60'
      })
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });
    expect(sdk.rateLimit).toBeNull();

    const transcript = await sdk.getTranscript('abc', ['id', 'title']);

    expect(transcript).toEqual({ id: 'abc', title: 'Standup' });
    expect(sdk.rateLimit).toMatchObject({ limit: 500, remaining: 499, reset: 3600, retryAfter: null, observedAt: NOW });
    expect(sdk.rateLimit?.windows['api_burst']).toEqual({ name: 'api_burst', limit: 30, remaining: 29, reset: 60 });
  });

  it('keeps the previous state when a response carries no headers', async () => {
    installTransport([ok({ 'x-ratelimit-remaining': '10' }), ok()]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });
    await sdk.getTranscript('abc');
    await sdk.getTranscript('abc');
    expect(sdk.rateLimit?.remaining).toBe(10);
  });

  it('never lets a late, stale response hand back quota a concurrent one already reported as spent', async () => {
    // Request 1 is served first (4 left) but its response arrives last;
    // request 2 is served second (0 left) and arrives first.
    installTransport([
      { ...ok({ 'x-ratelimit-remaining-api_burst': '4', 'x-ratelimit-reset-api_burst': '42', 'x-ratelimit-limit-api_burst': '30' }), delayMs: 50 },
      ok({ 'x-ratelimit-remaining-api_burst': '0', 'x-ratelimit-reset-api_burst': '42', 'x-ratelimit-limit-api_burst': '30' })
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });

    const slow = sdk.getTranscript('a'); // takes step 1 (4 left, arrives after 50 ms) ...
    const fast = sdk.getTranscript('b'); // ... and step 2 (0 left, arrives at once)
    await settle(Promise.all([fast, slow]), 100);

    expect(sdk.rateLimit?.windows['api_burst'].remaining).toBe(0);
  });

  it('waits for an exhausted suffixed window when a 429 carries neither Retry-After nor a retry timestamp', async () => {
    const requests = installTransport([
      {
        status: 429,
        headers: { 'x-ratelimit-remaining-api_burst': '0', 'x-ratelimit-reset-api_burst': '3' },
        body: { errors: [{ message: 'Too many requests', extensions: { code: 'too_many_requests' } }], data: null }
      },
      ok()
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });

    const pending = sdk.getTranscript('abc');
    await jest.advanceTimersByTimeAsync(2_999);
    expect(requests).toHaveLength(1);

    await expect(settle(pending, 1)).resolves.toEqual({ id: 'abc', title: 'Standup' });
    expect(requests).toHaveLength(2);
  });

  it('waits Retry-After seconds on an HTTP 429 and then retries', async () => {
    const requests = installTransport([
      {
        status: 429,
        headers: { 'Retry-After': '2', 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '2' },
        body: tooManyBody(NOW + 2_000)
      },
      ok({ 'x-ratelimit-remaining': '29' })
    ]);
    const onRateLimited = jest.fn();
    const sdk = new FirefliesSDK({ apiKey: 'key', rateLimit: { onRateLimited } });

    const pending = sdk.getTranscript('abc', ['id']);
    // Nothing is retried before the window reopens.
    await jest.advanceTimersByTimeAsync(1_999);
    expect(requests).toHaveLength(1);

    const transcript = await settle(pending, 1);

    expect(transcript).toEqual({ id: 'abc', title: 'Standup' });
    expect(requests).toHaveLength(2);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
    expect(onRateLimited).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, waitMs: 2_000, rateLimit: expect.objectContaining({ retryAfter: 2, remaining: 0 }) })
    );
    expect(sdk.rateLimit?.remaining).toBe(29);
  });

  it('retries a too_many_requests GraphQL error on a 200 using metadata.retryAfter (epoch ms)', async () => {
    const requests = installTransport([
      { status: 200, body: tooManyBody(NOW + 1_500) },
      ok()
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });

    const pending = sdk.getTranscript('abc');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(1);

    await expect(settle(pending, 500)).resolves.toEqual({ id: 'abc', title: 'Standup' });
    expect(requests).toHaveLength(2);
  });

  it('gives up after maxRetries and surfaces the retry-after value', async () => {
    const rejected = (): ScriptedResponse => ({
      status: 429,
      headers: { 'retry-after': '1' },
      body: tooManyBody(NOW + 1_000)
    });
    const requests = installTransport([rejected(), rejected(), rejected()]);
    const sdk = new FirefliesSDK({ apiKey: 'key', rateLimit: { maxRetries: 2 } });

    let caught: unknown;
    try {
      await settle(sdk.getTranscript('abc'), 10_000);
    } catch (error) {
      caught = error;
    }

    expect(requests).toHaveLength(3);
    expect(caught).toBeInstanceOf(FirefliesRateLimitError);
    const error = caught as FirefliesRateLimitError;
    expect(error.code).toBe('too_many_requests');
    expect(error.retryAfter).toBe(1);
    expect(error.attempts).toBe(3);
    expect(error.rateLimit?.retryAfter).toBe(1);
    expect(error.message).toContain('Fireflies API Error');
    expect(error.message).toContain('retry after 1 seconds');
    expect(error.message).toContain('docs.fireflies.ai/fundamentals/limits');
  });

  it('does not wait longer than maxRetryWaitMs (an exhausted daily quota fails fast)', async () => {
    const requests = installTransport([
      { status: 429, headers: { 'retry-after': '3600' }, body: tooManyBody(NOW + 3_600_000) }
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });

    let caught: unknown;
    try {
      await settle(sdk.getTranscript('abc'), 10);
    } catch (error) {
      caught = error;
    }

    expect(requests).toHaveLength(1);
    expect(caught).toBeInstanceOf(FirefliesRateLimitError);
    expect((caught as FirefliesRateLimitError).retryAfter).toBe(3600);
    expect((caught as FirefliesRateLimitError).retryAt?.getTime()).toBe(NOW + 3_600_000);
  });

  it('can be disabled with maxRetries: 0', async () => {
    const requests = installTransport([{ status: 429, headers: { 'retry-after': '1' }, body: tooManyBody(NOW + 1_000) }]);
    const sdk = new FirefliesSDK({ apiKey: 'key', rateLimit: { maxRetries: 0 } });

    await expect(settle(sdk.getTranscript('abc'), 10)).rejects.toBeInstanceOf(FirefliesRateLimitError);
    expect(requests).toHaveLength(1);
  });

  it('still reports other HTTP errors the way it always did', async () => {
    installTransport([{ status: 401, body: { message: 'Unauthorized' } }]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });
    await expect(sdk.getTranscript('abc')).rejects.toThrow('Fireflies API Error: Unauthorized');
  });

  it('surfaces a non-rate-limit GraphQL error instead of returning undefined', async () => {
    installTransport([
      { status: 200, body: { data: null, errors: [{ message: 'Object not found', extensions: { code: 'object_not_found' } }] } }
    ]);
    const sdk = new FirefliesSDK({ apiKey: 'key' });
    await expect(sdk.getTranscript('abc')).rejects.toThrow('Fireflies API Error: Object not found');
  });
});
