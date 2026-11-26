# Fireflies Node.js SDK

This package is a TypeScript client for the Fireflies GraphQL API. The [README](README.md) documents the public methods and their usage.

## Start here

| Change | Source | Tests |
| --- | --- | --- |
| Public exports or types | [src/index.ts](src/index.ts), [src/types.ts](src/types.ts) | [API operation tests](tests/api-surface.test.ts) |
| GraphQL queries, mutations, or request handling | [src/fireflies.ts](src/fireflies.ts) | [API operation tests](tests/api-surface.test.ts), [SDK retry tests](tests/fireflies-retry.test.ts) |
| Rate-limit headers, retry timing, or pacing decisions | [src/rate-limit.ts](src/rate-limit.ts) | [Rate-limit tests](tests/rate-limit.test.ts), [SDK retry tests](tests/fireflies-retry.test.ts) |
| Multi-user meeting fetches or batch pacing | [src/helper.ts](src/helper.ts) | [Batch pacing tests](tests/batch-pacing.test.ts) |

## Run the pull request checks

Use Node.js 26.13.1 to match the [CI workflow](.github/workflows/ci.yml). Run these commands from the repository root:

```sh
.github/release-notes/check.sh
npm ci
npm run build
npm test
```

The build type-checks `src/` and emits ESM, CommonJS, and declaration files under `dist/`. Jest tests do not need a Fireflies API key or a running service. The lint script is not part of CI and fails because the repository has no ESLint 9 configuration.

## Check changes to the public package

- For a changed public method, compare its GraphQL operation and variables against the API and update the corresponding tests. Keep the public types and README usage in sync.
- Use mocked responses for local tests. Never add real API keys or meeting data to fixtures, examples, or logs.
- Do not bump the package version to verify a change. Merging a new version to `main` triggers publishing. For an intended version bump, follow the [release notes instructions](.github/release-notes/README.md).
