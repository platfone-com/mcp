# Platfone MCP Server

[Platfone](https://platfone.com) provides virtual phone numbers for account verification, testing, and automation workflows. The Platfone MCP server enables AI agents to obtain temporary numbers and receive SMS messages from MCP-compatible clients like Claude, VS Code Copilot, Codex, etc.

## Why MCP?

Instead of manually integrating the API, AI agents can:

- Order numbers autonomously by country and service name
- Wait for SMS codes
- Retry or cancel activations

All via structured tool calls — no custom backend required.

## Features

- **Full activation lifecycle** — from ordering a number to receiving SMS
- **ETag-cached catalog** — countries and services are cached in-memory with 5-minute TTL and ETag-based conditional refresh — never sent to the agent
- **Human-friendly inputs** — use "Israel" or "Telegram" instead of IDs; names are auto-resolved server-side
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

- Always call `check_price` first to verify cost and availability
- Then call `order_number` to rent a number
- Call `check_sms` until SMS is received or expired
- Use `retry_activation` if no SMS arrives
- Use `cancel_activation` to release funds if no longer needed

## Tools

| Tool                | Description                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `get_balance`       | Check account balance: total, reserved, and available funds.                                              |
| `check_price`       | Check pricing and availability for a country + service pair before ordering.                              |
| `order_number`      | Order a virtual phone number. Accepts names ("Israel") or IDs ("il"). Returns `activation_id` + `phone`. |
| `check_sms`         | Poll activation state. Returns SMS code when received, or current status with polling instructions.       |
| `retry_activation`  | Request another SMS on the same number. Free of charge.                                                   |
| `cancel_activation` | Cancel an active activation before SMS is received. Refunds reserved amount.                              |

> **Note:** Country and service catalogs are cached server-side and auto-resolved from human-readable names.
> The agent never receives the full catalog — only resolved IDs or disambiguation hints.

### Typical AI Agent Flow

```
1. check_price         (country: "Israel", service: "Telegram")  → verify cost & availability
2. order_number        (country: "Israel", service: "Telegram")  → returns activation_id + phone
3. check_sms           (activation_id)                            → poll or check once for SMS
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
