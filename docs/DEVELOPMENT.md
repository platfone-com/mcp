# Development

## Prerequisites

- Node.js ≥ 18
- [Platfone Sandbox API key](https://platfone.com/test/app/api)

---

## Setup


### 1. Clone the repository and install dependencies
```bash
git clone https://github.com/platfone-com/mcp.git && cd mcp
npm install
```

### 2. Get a sandbox API key

- https://platfone.com/test
- Register / log in
- Copy your API key

### 3. Configure `.env`

```bash
cp .env.example .env
```

**Example (sandbox):**

```env
PLATFONE_API_KEY=your_sandbox_api_key_here
PLATFONE_API_URL=https://temp-number-api.com/test/api/v1
```

> For sandbox usage, `PLATFONE_API_URL` must be set to the test endpoint.

**Example (production):**

```env
PLATFONE_API_KEY=your_api_key_here
# PLATFONE_API_URL not required
```

<details>
<summary>Environment Variables</summary>

| Variable           | Required | Description                                                                          |
| ------------------ | -------- | ------------------------------------------------------------------------------------ |
| `PLATFONE_API_KEY` | Yes      | Your Platfone API key. For HTTP transport, can also be passed via `x-api-key` header |
| `PLATFONE_API_URL` | No       | Override API base URL (default: `https://temp-number-api.com/api/v1`)                |

> Configure `.env` before running the server.

</details>

---

## Running Locally

### Development mode (no build)

```bash
# stdio transport
npm run dev:stdio

# HTTP transport
npm run dev:http
```

### Production mode (build required)

```bash
npm run build
```

```bash
# stdio transport
npm start

# HTTP transport
npm run start:http
```

HTTP endpoint: `http://localhost:3000/mcp` by default. Can be changed via `--port` flag.


---

## Testing with Clients

### MCP Inspector (recommended)

```bash
PLATFONE_API_KEY=your_sandbox_key PLATFONE_API_URL=https://temp-number-api.com/test/api/v1 \
npx @modelcontextprotocol/inspector node dist/index.js
```

Open: [http://localhost:6274](http://localhost:6274)

Steps:

1. Connect
2. Call `check_price` with a country and service name
3. Call `order_number`
4. Send test SMS via [dashboard](https://platfone.com/test/app)
5. Call `check_sms`

---

### VS Code Copilot

Create `.vscode/mcp.json`:

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

---

### Claude Desktop

Config file:

* macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
* Windows: `%APPDATA%\Claude\claude_desktop_config.json`
* Linux: `~/.config/Claude/claude_desktop_config.json`

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

---

### HTTP (curl)

Start server:

```bash
npm run dev:http
```

Initialize session:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: your_sandbox_api_key_here" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

Use returned `mcp-session-id`:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: your_sandbox_api_key_here" \
  -H "Mcp-Session-Id: SESSION_ID_HERE" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_price","arguments":{"country":"Israel","service":"Telegram"}}}'
```

---

## End-to-End Test

1. `order_number` → get `activation_id`
2. Send SMS via sandbox [dashboard](https://platfone.com/test/app)
3. `check_sms` → receive code

If this works, the MCP server is functioning correctly.
