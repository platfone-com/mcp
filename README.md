# Platfone MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the [Platfone SMS Activation API](https://platfone.com/docs/api/specs/activation-api-doc.html) as MCP tools. This makes Platfone accessible from any MCP-compatible client — Claude, VS Code Copilot, Codex, and more.

## Features

- **6 tools** covering the full SMS activation lifecycle
- **Session-cached catalog** — countries and services are fetched once per session, not per call
- **Name resolution** — `order_number` accepts human names ("Ukraine", "Telegram"), auto-resolves to IDs
- **Dual transport** — `stdio` and `http` from a single codebase
- **API key auth** — works with your existing Platfone API key

## Prerequisites

- Node.js ≥ 18
- [Platfone API key](https://platfone.com/app/api)

## Install & Build

```bash
git clone <repo-url> && cd platfone-mcp
npm install
npm run build
```

## Tools

| Tool | Description |
|---|---|
| `list_countries` | List countries where phone numbers are available. Cached per session. |
| `list_services` | List services (apps/platforms) for activation. Cached per session. |
| `order_number` | Order a virtual phone number. Accepts names ("Ukraine") or IDs ("ua"). Returns `activation_id` + `phone`. |
| `check_sms` | Poll activation state. Returns SMS code when received, or current status with polling instructions. |
| `retry_activation` | Request another SMS on the same number. Free of charge. |
| `cancel_activation` | Cancel an active activation before SMS is received. Refunds reserved amount. |

### Typical AI Agent Flow

```
1. order_number        (country: "Ukraine", service: "Telegram")  → returns activation_id + phone
2. check_sms           (activation_id)                            → poll or check once for SMS
```

Optional steps:
- `retry_activation` — request another SMS on the same number (free)
- `cancel_activation` — cancel before SMS arrives (refunds balance)


## Usage

### stdio transport (Claude, VS Code Copilot, Codex)

```bash
npm start
# or
PLATFONE_API_KEY=your_key node dist/index.js --transport=stdio
```

### HTTP transport

```bash
# Default port 3000
npm run start:http

# Custom port
npm start -- --transport=http --port=3000
```

The MCP endpoint will be available at `http://localhost:<port>/mcp`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PLATFONE_API_KEY` | Yes | Your Platfone API key. For HTTP transport, can also be passed via `x-api-key` header. |
| `PLATFONE_API_URL` | No | Override API base URL. Default: `https://temp-number-api.com/api/v1` |

For sandbox testing, use the sandbox API URL:

```
PLATFONE_API_URL=https://temp-number-api.com/test/api/v1
```

## Local Testing (step-by-step)

### Step 1: Get a Sandbox API Key

1. Go to [https://platfone.com/test](https://platfone.com/test)
2. Register / log in
3. Copy your **sandbox** API key

> Sandbox is free — no real money needed. You can send fake SMS via the web dashboard to test your flow.

### Step 2: Configure `.env`

```bash
cp .env.example .env
```

Edit `.env`:

```
PLATFONE_API_KEY=your_sandbox_api_key_here
PLATFONE_API_URL=https://temp-number-api.com/test/api/v1
```

### Step 3: Build

```bash
npm install
npm run build
```

### Step 4: Choose how to test

---

#### Option A: MCP Inspector (recommended for first test)

The official MCP Inspector gives you a web UI to call tools interactively:

```bash
PLATFONE_API_KEY=your_sandbox_key PLATFONE_API_URL=https://temp-number-api.com/test/api/v1 \
  npx @modelcontextprotocol/inspector node dist/index.js
```

This opens a browser at `http://localhost:6274`. Click **Connect**, then:
1. Go to the **Tools** tab — you should see all 6 tools listed
2. Call `list_countries` — browse available countries
3. Call `list_services` — browse available services
4. Call `order_number` with `country: "Ukraine"`, `service: "Telegram"`
5. Go to [Platfone sandbox dashboard](https://platfone.com/test) → send a fake SMS to the number
6. Call `check_sms` with the `activation_id` from step 4

---

#### Option B: VS Code Copilot

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "platfone": {
      "command": "node",
      "args": ["/absolute/path/to/platfone-mcp/dist/index.js", "--transport=stdio"],
      "env": {
        "PLATFONE_API_KEY": "your_sandbox_api_key_here",
        "PLATFONE_API_URL": "https://temp-number-api.com/test/api/v1"
      }
    }
  }
}
```

Then in VS Code Copilot chat, ask:
> "Order me a Telegram number in Ukraine"

Copilot will call `order_number` to get a phone number, then use `check_sms` to either poll automatically or check once on demand.

---

#### Option C: Claude Desktop

Add to your Claude Desktop config:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "platfone": {
      "command": "node",
      "args": ["/absolute/path/to/platfone-mcp/dist/index.js", "--transport=stdio"],
      "env": {
        "PLATFONE_API_KEY": "your_sandbox_api_key_here",
        "PLATFONE_API_URL": "https://temp-number-api.com/test/api/v1"
      }
    }
  }
}
```

Restart Claude Desktop, then ask:
> "Get me a phone number for Telegram in Ukraine and wait for the SMS code"

---

#### Option D: HTTP mode + curl

Start the server:

```bash
npm run dev:http
```

Then in another terminal, initialize a session:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: your_sandbox_api_key_here" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

Note the `mcp-session-id` from the response headers, then call tools:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: your_sandbox_api_key_here" \
  -H "Mcp-Session-Id: SESSION_ID_HERE" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_countries","arguments":{}}}'
```

---

### Step 5: Test the full flow

The happy-path flow to verify:

1. **`order_number`** → `country: "Ukraine"`, `service: "Telegram"` → get `activation_id` + `phone`
2. Go to [Platfone sandbox dashboard](https://platfone.com/test) → find the activation → send a fake SMS
3. **`check_sms`** → `activation_id` from step 1 → should return the SMS code

If this works end-to-end, the MCP server is functioning correctly.

## Development

```bash
# Run in stdio mode with tsx (no build needed)
npm run dev:stdio

# Run in HTTP mode
npm run dev:http

# Type-check
npx tsc --noEmit

# Format
npm run format
```

## Troubleshooting

| Error | Solution |
|---|---|
| `UnauthorizedException` | Check your `PLATFONE_API_KEY` is valid |
| `PaymentRequiredException` | Top up your Platfone balance |
| `NoNumbersAvailableException` | Try a different country or service |
| `TooManyRequestsException` | Rate limited — wait and retry |
| `MaxPriceExceededException` | Retry `order_number` with the suggested `max_price` and returned `order_id` |
| `TooManyActivationsException` | Max 20 active activations — cancel or wait for expiry |

## License

MIT
