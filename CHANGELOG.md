# Changelog

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
