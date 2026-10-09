import { FirefliesSDK } from '../src/fireflies';
import { MeetingsHelper, RateLimitSource } from '../src/helper';
import { RateLimitState } from '../src/rate-limit';

function state(remaining: number, reset: number, name = 'default'): RateLimitState {
  const window = { name, limit: null, remaining, reset };
  return {
    limit: null,
    remaining: name === 'default' ? remaining : null,
    reset: name === 'default' ? reset : null,
    retryAfter: null,
    windows: { [name]: window },
    observedAt: Date.now()
  };
}

/**
 * Build `count` tasks. Each task records which batch it ran in (batches are
 * separated by the helper's "Processing i to j" log line) and, when a
 * `schedule` entry exists for its index, publishes that rate-limit state the
 * way a real response would.
 */
function buildTasks(count: number, source: { rateLimit: RateLimitState | null }, schedule: Record<number, RateLimitState | null> = {}) {
  const ran: number[] = [];
  const tasks = Array.from({ length: count }, (_, i) => async () => {
    ran.push(i);
    if (i in schedule) source.rateLimit = schedule[i];
    return { data: { transcript: { id: `t${i}` } } };
  });
  return { tasks, ran };
}

describe('MeetingsHelper.batchProcess pacing', () => {
  let delays: number[];
  let batches: Array<[number, number]>;

  beforeEach(() => {
    delays = [];
    batches = [];
    jest.spyOn(MeetingsHelper as any, 'delay').mockImplementation(async (ms: unknown) => {
      delays.push(ms as number);
    });
    jest.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      const match = /^Processing (\d+) to (\d+) of/.exec(String(message));
      if (match) batches.push([Number(match[1]), Number(match[2])]);
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('falls back to 5 requests then a 5 s pause when no headers are available', async () => {
    const source: RateLimitSource = { rateLimit: null };
    const { tasks, ran } = buildTasks(12, source);

    const result = await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source });

    expect(ran).toHaveLength(12);
    expect(result.meetings).toHaveLength(12);
    expect(result.errors).toEqual([]);
    expect(batches).toEqual([[0, 5], [5, 10], [10, 12]]);
    expect(delays).toEqual([5000, 5000]);
  });

  it('keeps the historical behaviour when called without options', async () => {
    const { tasks } = buildTasks(7, { rateLimit: null });
    await MeetingsHelper.batchProcess(tasks, 'abc-key');
    expect(batches).toEqual([[0, 5], [5, 7]]);
    expect(delays).toEqual([5000]);
  });

  it('sends batches back to back while X-RateLimit-Remaining has room', async () => {
    const source = { rateLimit: null as RateLimitState | null };
    const { tasks } = buildTasks(12, source, { 0: state(400, 3000) });

    await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source });

    expect(batches).toEqual([[0, 5], [5, 10], [10, 12]]);
    expect(delays).toEqual([]);
  });

  it('shrinks the next batch to the remaining budget and waits out an empty window', async () => {
    const source = { rateLimit: null as RateLimitState | null };
    // After the first batch the burst window has 2 left; after those 2 it is empty and resets in 3 s;
    // once it resets the budget is back to plenty.
    const { tasks } = buildTasks(12, source, {
      4: state(2, 10, 'api_burst'),
      6: state(0, 3, 'api_burst'),
      11: state(25, 60, 'api_burst')
    });

    const result = await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source });

    expect(batches).toEqual([[0, 5], [5, 7], [7, 12]]);
    expect(delays).toEqual([3500]);
    expect(result.meetings).toHaveLength(12);
  });

  it('is not stalled by an exhausted call_join window on the source client', async () => {
    const callJoinExhausted: RateLimitState = {
      limit: null,
      remaining: null,
      reset: null,
      retryAfter: null,
      windows: { call_join: { name: 'call_join', limit: 3, remaining: 0, reset: 1150 } },
      observedAt: Date.now()
    };
    const source = { rateLimit: callJoinExhausted as RateLimitState | null };
    const { tasks, ran } = buildTasks(7, source);

    const result = await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source, maxWaitMs: 65_000 });

    expect(ran).toHaveLength(7);
    expect(result.errors).toEqual([]);
    expect(batches).toEqual([[0, 5], [5, 7]]);
  });

  it('stops instead of blocking when the window resets beyond maxWaitMs', async () => {
    const source = { rateLimit: null as RateLimitState | null };
    const { tasks, ran } = buildTasks(12, source, { 4: state(0, 7200) });

    const result = await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source, maxWaitMs: 65_000 });

    expect(ran).toEqual([0, 1, 2, 3, 4]);
    expect(delays).toEqual([]);
    expect(result.meetings).toHaveLength(5);
    expect(result.errors).toEqual(['Rate limit exhausted; 7 request(s) not sent, window resets in 7200s']);
  });

  it('getMeetingsForMultipleUsers paces the detail fetches with the client that did the ID discovery', async () => {
    let discoveryClients: { [key: string]: FirefliesSDK } | undefined;
    jest.spyOn(MeetingsHelper, 'getDedeuplicatedMeetingIds').mockImplementation(async (_keys, clients) => {
      discoveryClients = clients;
      return { 'key-one': ['t1'], 'key-two': ['t2'] };
    });
    const batchSpy = jest.spyOn(MeetingsHelper, 'batchProcess').mockResolvedValue({ meetings: [], errors: [] });
    jest.spyOn(MeetingsHelper, 'handleOutput').mockResolvedValue(undefined);

    await FirefliesSDK.getMeetingsForMultipleUsers(['key-one', 'key-two'], ['id']);

    expect(discoveryClients).toBeDefined();
    expect(Object.keys(discoveryClients!)).toEqual(['key-one', 'key-two']);
    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(batchSpy.mock.calls[0][2]).toEqual({ rateLimitSource: discoveryClients!['key-one'], label: 'key #1' });
    expect(batchSpy.mock.calls[1][2]).toEqual({ rateLimitSource: discoveryClients!['key-two'], label: 'key #2' });
    expect(batchSpy.mock.calls[0][2]!.rateLimitSource).toBe(discoveryClients!['key-one']);
  });

  it('keys clients without an object prototype, so a key like __proto__ still gets its own client', async () => {
    let discoveryClients: { [key: string]: FirefliesSDK } | undefined;
    jest.spyOn(MeetingsHelper, 'getDedeuplicatedMeetingIds').mockImplementation(async (_keys, clients) => {
      discoveryClients = clients;
      return {};
    });
    await FirefliesSDK.getMeetingsForMultipleUsers(['__proto__', 'constructor'], ['id']);
    expect(discoveryClients!['__proto__']).toBeInstanceOf(FirefliesSDK);
    expect(discoveryClients!['constructor']).toBeInstanceOf(FirefliesSDK);
  });

  it('never writes any part of the API key to the console', async () => {
    const logged: string[] = [];
    (console.log as jest.Mock).mockImplementation((message?: unknown) => logged.push(String(message)));
    (console.warn as jest.Mock).mockImplementation((message?: unknown) => logged.push(String(message)));
    const source = { rateLimit: null as RateLimitState | null };
    const { tasks } = buildTasks(3, source, { 0: state(0, 7200) });

    await MeetingsHelper.batchProcess(tasks, 'secret-api-key-value', { rateLimitSource: source, label: 'key #7' });

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('secret');
      expect(line).toContain('key #7');
    }
  });

  it('records a failing task as an error and carries on', async () => {
    const source = { rateLimit: null as RateLimitState | null };
    const { tasks } = buildTasks(3, source, { 0: state(100, 60) });
    tasks[1] = async () => {
      throw new Error('boom');
    };

    const result = await MeetingsHelper.batchProcess(tasks, 'abc-key', { rateLimitSource: source });

    expect(result.meetings.map(m => m.id)).toEqual(['t0', 't2']);
    expect(result.errors).toEqual(['boom']);
  });
});
