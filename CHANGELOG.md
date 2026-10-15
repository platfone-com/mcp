# Changelog

## Unreleased

- **Security:** HTTP sessions are now bound to the credential that initialized them. `POST`, `GET` and `DELETE` on `/mcp` require the same `x-api-key` (or the same server-key fallback); missing credentials return `401`, and mismatched credentials are handled as an unknown session without affecting the owner's session.
- HTTP sessions now also have an absolute lifetime of 12 hours in addition to the 30-minute idle timeout, enforced on every request and by the background sweeper.
- Added `npm test` with HTTP transport session-binding tests.
- **Security:** new HTTP sessions are admitted only after the API key is verified with the Platfone API. Invalid or missing keys get `401` and never occupy the session pool or trigger catalog warm-up. Checks are timeout- and concurrency-bounded, cached per key fingerprint, and fail closed with `503` when the Platfone API is unavailable.
- Session creation is rate limited per client address (30/min) and capped at 20 active sessions per API key; established-session traffic is not affected. Optional `MCP_CLIENT_IP_HEADER` selects a trusted proxy header for the client address.
- Sessions are closed when the Platfone API rejects their key during a tool call (e.g. revoked key), and interrupted initializations release their slot.
- Optional Prometheus metrics (`MCP_METRICS_PORT`): admissions by result, credential checks, active/pending sessions and session cleanup by reason.
- **Security (dependencies):** upgraded `@modelcontextprotocol/sdk` to 1.32.1 and `express` to 4.22.3 (dev: `tsx` 4.23); the lockfile now resolves patched `fast-uri` 3.1.8, `ip-address` 10.7.4, `hono` 4.13.13, `@hono/node-server` 2.1.5, `qs` 6.16.1, `proxy-addr` 2.0.8, `body-parser` 1.20.8 and `esbuild` 0.28. `npm audit` reports no vulnerabilities.

## 1.1.0 — 2026-04-03

- **Removed** `list_countries` and `list_services` tools — catalog is no longer exposed to the agent.
- **Added** `get_balance` and `check_price` tools
- Country and service catalogs are now cached in-memory with 5-minute TTL and ETag-based conditional refresh (`X-ETag` / `If-None-Match`)
- Country and service names are auto-resolved server-side via fuzzy matching in `order_number` and `check_price`
- Ambiguous matches return a short disambiguation list instead of the full catalog

## 1.0.0 — 2026-03-26

Initial public release.

- **Tools:** `list_countries`, `list_services`, `order_number`, `check_sms`, `retry_activation`, `cancel_activation`
- **Transports:** stdio and Streamable HTTP
- Session-cached country/service catalog with fuzzy name resolution
- Human-readable names accepted for countries and services
- Idle HTTP session cleanup (30-minute TTL)
- Set MCP server version from `package.json`
- Docker image published to GHCR (`ghcr.io/platfone-com/mcp`)
- Documentation for installation, development, and security policy
- GitHub Actions for npm publish and Docker image build
