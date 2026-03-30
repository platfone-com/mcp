# Changelog

## 1.0.0 — 2026-03-26

Initial public release.

- **Tools:** `list_countries`, `list_services`, `order_number`, `check_sms`, `retry_activation`, `cancel_activation`
- **Transports:** stdio and Streamable HTTP
- Session-cached country/service catalog with fuzzy name resolution
- Human-readable names accepted for countries and services
- Idle HTTP session cleanup (30-minute TTL)
- Set MCP server version from `package.json`
- Documentation for installation, development, and security policy
- GitHub Actions for npm publish
