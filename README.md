# Fireflies.ai Node.js SDK

A Node.js SDK for interacting with the Fireflies.ai GraphQL API. This SDK provides a simple interface to access Fireflies.ai's meeting transcription and analysis features.

## Installation

```bash
npm install @firefliesai/fireflies-node-sdk
# or
yarn add @firefliesai/fireflies-node-sdk
```

## Quick Start

```javascript
const { FirefliesSDK } = require("@firefliesai/fireflies-node-sdk");
// Or using ES modules:
// import { FirefliesSDK } from '@firefliesai/fireflies-node-sdk';

const fireflies = new FirefliesSDK({
  apiKey: process.env.FIREFLIES_API_KEY,
});

async function main() {
  try {
    // Get current user info - see docs.fireflies.ai for all available fields
    const userInfo = await fireflies.getCurrentUser(["email", "name"]);
    console.log("User:", userInfo);

    // Get recent transcripts - see docs.fireflies.ai for all available fields
    const transcripts = await fireflies.getTranscripts(
      { limit: 10, mine: true },
      ["id", "title"]
    );
    console.log("Recent transcripts:", transcripts);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
```

## Environment Variables

Create a `.env` file in your project root:

```env
FIREFLIES_API_KEY=your_api_key_here
```

## Features

- User Management
  - Get current user
  - Get user by ID
  - Set user roles
- Transcript Management
  - Get transcripts
  - Get single transcript
  - Delete transcript
  - Get meetings for multiple users (with deduplication)
- Bites (Meeting Highlights)
  - Create bites
  - Get bites
  - Get single bite
- Audio Upload
  - Upload audio files for transcription
- Live Meeting Integration
  - Add Fireflies to live meetings
- Rate-Limit Awareness
  - Automatic, bounded retry of `429` / `too_many_requests` responses honouring `Retry-After`
  - Batch helper paced from the `X-RateLimit-*` headers
  - Parsed rate-limit state exposed on the client (`sdk.rateLimit`)

## API Reference

For a complete list of available fields and schema information, please refer to the [official Fireflies.ai documentation](https://docs.fireflies.ai).

### User Methods

```javascript
// Get current user - see docs.fireflies.ai for all available fields
await fireflies.getCurrentUser(["email", "name"]);

// Get user by ID - see docs.fireflies.ai for all available fields
await fireflies.getUser("user_id", ["email", "name"]);

// Set user role
await fireflies.setUserRole("user_id", "admin");
```

### Transcript Methods

```javascript
// Get transcripts - see docs.fireflies.ai for all available fields
await fireflies.getTranscripts({ limit: 50, mine: true }, [
  "id",
  "title",
  "privacy",
]);

// Get single transcript - see docs.fireflies.ai for all available fields
await fireflies.getTranscript("transcript_id", ["id", "title"]);

// Delete transcript
await fireflies.deleteTranscript("transcript_id");

// Get meetings for multiple users with deduplication
const meetings = await FirefliesSDK.getMeetingsForMultipleUsers(
  ["api-key-1", "api-key-2"],
  ["id", "title", "duration", "summary { keywords action_items }"],
  "json" // or 'console' for console output
);

// Find questions from external participants
const { externalParticipants, questions } =
  await fireflies.findExternalParticipantQuestions("@yourcompany.com");
console.log("External Participants:", externalParticipants);
console.log("Questions:", questions);

// Get video URLs from meetings
const meetings = await fireflies.getMeetingVideos();
meetings.forEach((meeting) => {
  if (meeting.video_url) {
    console.log(`Meeting: ${meeting.title}\nVideo URL: ${meeting.video_url}\n`);
  }
});

// Get transcript summary
const summary = await fireflies.getTranscriptSummary("transcript_id");
console.log("Overview:", summary.overview);
console.log("Action Items:", summary.action_items);
console.log("Keywords:", summary.keywords);
```

### Bites Methods

```javascript
// Get bites - see docs.fireflies.ai for all available fields
await fireflies.getBites({ mine: true, limit: 10 }, ["id", "name", "status"]);

// Create bite
await fireflies.createBite({
  transcript_id: "transcript_id",
  start_time: 120,
  end_time: 180,
});
```

### Audio Upload

```javascript
await fireflies.uploadAudio({
  url: "https://example.com/audio.mp3",
  title: "Meeting Recording",
  custom_language: "en",
});
```

## Advanced Features

### Getting Meetings for Multiple Users

The SDK provides a powerful feature to fetch and deduplicate meetings across multiple users:

```javascript
const meetings = await FirefliesSDK.getMeetingsForMultipleUsers(
  ["api-key-1", "api-key-2", "api-key-3"],
  [
    "id",
    "title",
    "duration",
    "date",
    "host_email",
    "organizer_email",
    "summary { keywords action_items overview }",
  ],
  "json" // Output results to JSON files
);

// Results are also returned in the response
for (const [apiKey, result] of Object.entries(meetings)) {
  console.log(`API Key ${apiKey.split("-")[0]}:`);
  console.log(`- Meetings found: ${result.meetings.length}`);
  console.log(`- Errors encountered: ${result.errors.length}`);
}
```

This method:

- Fetches meetings for multiple users using their API keys
- Deduplicates meetings to ensure each meeting is assigned to only one user
- Processes requests in batches, paced from the API's `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers (falls back to 5 requests then a 5 s pause when the headers are absent)
- Supports both console output and JSON file output
- Handles errors gracefully and provides detailed error reporting

When using 'json' output, the results are saved to:

- `RESULTS_{api-key}.json`: Contains the meetings for each API key
- `ERRORS_{api-key}.json`: Contains any errors encountered for each API key

## Rate Limits

The Fireflies API enforces per-plan limits (a per-minute limit on every plan, plus a daily quota on
Free and Pro; Business and Enterprise pool their per-minute budget across the team). The numbers
and the rules live on the
[Limits page of the API documentation](https://docs.fireflies.ai/fundamentals/limits) — the SDK
never hardcodes them. Instead it reads what every response reports:

| Header                  | Meaning                                                  |
| ----------------------- | -------------------------------------------------------- |
| `X-RateLimit-Limit`     | Size of the window                                       |
| `X-RateLimit-Remaining` | Requests left in that window                             |
| `X-RateLimit-Reset`     | Seconds until the window resets                          |
| `Retry-After`           | On a `429` only: seconds to wait before retrying         |

Suffixed variants (`X-RateLimit-*-api`, `X-RateLimit-*-api_burst`, ...) describe each window
separately and are parsed too.

### Automatic retry

A request rejected with HTTP `429`, or with a GraphQL error whose `extensions.code` is
`too_many_requests`, is retried after the wait the server asks for: the `Retry-After` header, or
failing that `extensions.metadata.retryAfter` (an epoch timestamp in **milliseconds**). The SDK
never retries early — retrying before the window reopens extends the block — and never waits longer
than `maxRetryWaitMs`, so an exhausted daily quota surfaces immediately instead of blocking your
process for hours.

```javascript
const fireflies = new FirefliesSDK({
  apiKey: process.env.FIREFLIES_API_KEY,
  rateLimit: {
    maxRetries: 3, // default; 0 disables retries
    maxRetryWaitMs: 65_000, // default; longer waits are surfaced as an error instead
    onRateLimited: ({ attempt, waitMs }) =>
      console.warn(`Rate limited, retry ${attempt} in ${waitMs} ms`),
  },
});
```

When the retries are used up the call rejects with a `FirefliesRateLimitError`:

```javascript
const { FirefliesRateLimitError } = require("@firefliesai/fireflies-node-sdk");

try {
  await fireflies.getTranscripts({ limit: 50 }, ["id"]);
} catch (error) {
  if (error instanceof FirefliesRateLimitError) {
    console.error(`Rate limited. Retry after ${error.retryAfter}s (at ${error.retryAt})`);
    console.error("Window that rejected the request:", error.rateLimit);
  }
}
```

### Inspecting the current state

`sdk.rateLimit` holds the parsed headers of the most recent response (or `null` before the first
one). Use it to throttle your own loops:

```javascript
await fireflies.getCurrentUser(["email"]);
const state = fireflies.rateLimit; // null until a response carried the headers
if (state) {
  console.log(`${state.remaining}/${state.limit} requests left, window resets in ${state.reset}s`);
  console.log("Per-minute burst window:", state.windows.api_burst);
}
```

`getMeetingsForMultipleUsers` and `MeetingsHelper.batchProcess` use the same state to size each
batch and to wait out an empty window. Pass `{ rateLimitSource: sdk }` when calling
`batchProcess` directly, and `concurrency` / `fallbackDelayMs` / `maxWaitMs` to tune it.

## Error Handling

The SDK uses standard Node.js error handling:

```javascript
const { FirefliesRateLimitError } = require("@firefliesai/fireflies-node-sdk");

try {
  const transcripts = await fireflies.getTranscripts();
} catch (error) {
  if (error instanceof FirefliesRateLimitError) {
    console.error(`Rate limited, retry after ${error.retryAfter}s`);
  } else if (error.message.includes("API Error")) {
    console.error("Fireflies API Error:", error.message);
  } else {
    console.error("Network or other error:", error);
  }
}
```

## Examples

Check the [examples](./examples) directory for more usage examples.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build package
npm run build
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Credits

- [Haruna Ahmadu](https://github.com/sleemkeen)
- [Muhammad Abdullah](https://github.com/MrMuhammadAbdullah1704)
- [All Contributors](../../contributors)

## License

MIT

## Support

- [Official Documentation](https://docs.fireflies.ai)
- [API Reference](https://docs.fireflies.ai/graphql-api)
- [Support Portal](https://help.fireflies.ai)
- [GitHub Issues](https://github.com/fireflies-ai/node-sdk/issues)
