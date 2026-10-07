# Changelog

All notable changes to `@firefliesai/fireflies-node-sdk` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-07

### Added

- **Rate-limit aware client.** A request rejected with HTTP `429` or a GraphQL
  `too_many_requests` error is retried automatically after the wait the server asks
  for (`Retry-After` header, falling back to `extensions.metadata.retryAfter`, an
  epoch timestamp in milliseconds). Retries are bounded (3 by default) and the SDK
  never waits longer than `rateLimit.maxRetryWaitMs` (65 s by default), so an
  exhausted daily quota fails fast instead of blocking the process. Configure with
  `new FirefliesSDK({ apiKey, rateLimit: { maxRetries, maxRetryWaitMs, onRateLimited } })`.
- `FirefliesRateLimitError` (exported) is thrown when the retries are used up. It
  carries `retryAfter` (seconds), `retryAt` (`Date`), `attempts` and the parsed
  `rateLimit` state. Its message keeps the `Fireflies API Error:` prefix.
- `sdk.rateLimit` exposes the `X-RateLimit-Limit` / `-Remaining` / `-Reset` state of
  the most recent response, including every suffixed window (`api`, `api_burst`, ...).
- `MeetingsHelper.batchProcess(tasks, apiKey, options)` accepts a `rateLimitSource`
  (a `FirefliesSDK` instance) and paces itself from `X-RateLimit-Remaining` /
  `X-RateLimit-Reset`: the next batch shrinks to the requests left in the most
  constrained window and an empty window is waited out instead of sleeping a fixed
  5 s. `concurrency`, `fallbackDelayMs` and `maxWaitMs` are configurable.
  `FirefliesSDK.getMeetingsForMultipleUsers` uses this automatically.
- `parseRateLimitHeaders`, `resolveRetryDelayMs` and `RateLimitPacer` are exported for
  callers who drive their own request loops.
- Jest configuration and unit tests for the retry path and the header-driven pacing.

### Changed

- The batch helper keeps its historical schedule (5 requests, then a 5 s pause) only
  as the fallback when the API sends no rate-limit headers.
- A GraphQL response with `errors` and no `data` now throws
  `Fireflies API Error: <message>` instead of returning `undefined` and failing later
  with a `TypeError`.

### Notes

- Plan limits are documented at <https://docs.fireflies.ai/fundamentals/limits>. The
  headers this release reads are emitted by the API from `public-api-ff` PR #1413
  onward; against an older API the SDK behaves as before.

## [1.1.3] and earlier

No changelog was kept before 1.2.0. See the
[commit history](https://github.com/firefliesai/fireflies-node-sdk/commits/main).
