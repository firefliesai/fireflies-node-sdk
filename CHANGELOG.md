# Changelog

All notable changes to `@firefliesai/fireflies-node-sdk` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-09

### Added

- **The rest of the public GraphQL API.** New methods, each typed and linked to its docs page:
  - Meetings: `getActiveMeetings`, `updateMeetingTitle`, `updateMeetingPrivacy`,
    `updateMeetingChannel`, `shareMeeting`, `revokeSharedMeetingAccess`
  - Direct upload: `createUploadUrl`, `confirmUpload`
  - Live meetings: `updateMeetingState`, `createLiveActionItem`, `createLiveSoundbite`,
    `getLiveActionItems`
  - AskFred: `createAskFredThread`, `continueAskFredThread`, `getAskFredThreads`,
    `getAskFredThread`, `deleteAskFredThread`
  - Channels, contacts, user groups: `getChannels`, `getChannel`, `getContacts`,
    `getUserGroups`, `addUserToUserGroup`, `removeUserFromUserGroup`
  - Analytics, audit log, rules: `getAnalytics`, `getAuditEvents`, `getRuleExecutionsByMeeting`
- Methods that select fields fall back to a sensible default selection when given none
  (previously an empty selection produced a GraphQL syntax error).
- `getTranscripts` accepts `keyword`, `scope`, `organizers`, `participants` and `channel_id`;
  `getBites` accepts `skip`; `uploadAudio` accepts `download_auth`, `bypass_size_check` and
  `meeting_date`.
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
  5 s; a window that will not have reset by then still caps the batch. Concurrent
  responses are merged conservatively (`mergeRateLimitState`), so a late response
  can never hand back quota an earlier one reported as spent, and windows a
  response does not mention are carried over until they expire. Only the windows
  that meter every request (`default`, `api`, `api_burst`) drive the pacing;
  endpoint-specific ones such as `call_join` are ignored by it. `concurrency`,
  `fallbackDelayMs` and `maxWaitMs` are configurable.
  `FirefliesSDK.getMeetingsForMultipleUsers` uses this automatically.
- `parseRateLimitHeaders`, `resolveRetryDelayMs` and `RateLimitPacer` are exported for
  callers who drive their own request loops.
- Jest configuration, unit tests for the retry path and the header-driven pacing, and a
  GitHub Actions workflow that runs the build and the tests on every pull request.

### Fixed

- `createBite` sent `transcript_id`; the schema argument is `transcript_Id`, so every call
  failed validation. It also declared `privacies` as `[String]` instead of `[BitePrivacy]`.
- `addToLiveMeeting` declared `attendees` as `[Attendee]`; the input type is `AttendeeInput`,
  so any call that passed attendees failed validation.
- `getTranscripts` silently ignored `fromDate`, `toDate` and `organizer_email`: they were sent
  as variables but never declared or passed to the query.

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
