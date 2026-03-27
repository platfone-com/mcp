# Platfone MCP Server

[Platfone](https://platfone.com) provides virtual phone numbers for account verification, testing, and automation workflows. The Platfone MCP server enables AI agents to obtain temporary numbers and receive SMS messages from MCP-compatible clients like Claude, VS Code Copilot, Codex, etc.

## Why MCP?

Instead of manually integrating the API, AI agents can:

- Discover available countries/services
- Order numbers autonomously
- Wait for SMS codes
- Retry or cancel activations

All via structured tool calls — no custom backend required.

## Features

- **Full activation lifecycle** — from ordering a number to receiving SMS
- **Session-cached catalog** — countries and services are fetched once per session, not per call
- **Human-friendly inputs** — use "Ukraine" or "Telegram" instead of IDs
- **Dual transport** — `stdio` and `http` from a single codebase
- **API key auth** — works with your existing Platfone API key

## Installation

See the full [Installation Guide](https://platfone.com/docs/mcp/install) for detailed instructions.

### Quick Start

**NPM:**

```bash
PLATFONE_API_KEY=your_key npx @platfone/mcp
```

## Agent Guidelines

- Always call `order_number` first
- Then call `check_sms` until SMS is received or expired
- Use `retry_activation` if no SMS arrives
- Use `cancel_activation` to release funds if no longer needed

## Tools

| Tool                | Description                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `list_countries`    | List countries where phone numbers are available. Cached per session.                                     |
| `list_services`     | List services (apps/platforms) for activation. Cached per session.                                        |
| `order_number`      | Order a virtual phone number. Accepts names ("Ukraine") or IDs ("ua"). Returns `activation_id` + `phone`. |
| `check_sms`         | Poll activation state. Returns SMS code when received, or current status with polling instructions.       |
| `retry_activation`  | Request another SMS on the same number. Free of charge.                                                   |
| `cancel_activation` | Cancel an active activation before SMS is received. Refunds reserved amount.                              |

### Typical AI Agent Flow

```
1. order_number        (country: "Ukraine", service: "Telegram")  → returns activation_id + phone
2. check_sms           (activation_id)                            → poll or check once for SMS
```

Optional steps:
- `retry_activation` — request another SMS on the same number (free)
- `cancel_activation` — cancel before SMS arrives (refunds balance)

## Development

Read the full [Development Guide](docs/DEVELOPMENT.md) for setup instructions and testing tips.


## Troubleshooting

| Error                         | Solution                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| `UnauthorizedException`       | Check your `PLATFONE_API_KEY` is valid                                      |
| `PaymentRequiredException`    | Top up your Platfone balance                                                |
| `NoNumbersAvailableException` | Try a different country or service                                          |
| `TooManyRequestsException`    | Rate limited — wait and retry                                               |
| `MaxPriceExceededException`   | Retry `order_number` with the suggested `max_price` and returned `order_id` |
| `TooManyActivationsException` | Max concurrent active activations reached — cancel or wait for expiry       |

## License

See [LICENSE.md](./LICENSE.md). Licensed under the MIT License.
