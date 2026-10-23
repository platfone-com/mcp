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
| `MCP_CLIENT_IP_HEADER` | No   | HTTP only. Header with the real client address set by a trusted proxy (e.g. `cf-connecting-ip`). Used for the per-client session-creation limit; leave unset unless the proxy always overwrites it |
| `MCP_METRICS_PORT` | No       | HTTP only. Serves Prometheus metrics at `http://<host>:<port>/metrics` on a separate port; keep it off the public ingress |

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

### Docker

Both the build and production stages use Node.js 24.22.1 on Alpine Linux. The production container runs as the non-root `node` user and defaults to stdio transport.

```bash
docker build -t platfone-mcp .

# stdio transport
docker run --rm -i --env-file .env platfone-mcp

# HTTP transport
docker run --rm -p 3000:3000 --env-file .env platfone-mcp \
  node dist/index.js --transport=http
```


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

#### Session binding and lifetime

An HTTP session is bound to the credential that initialized it: the `x-api-key` header, or the server `PLATFONE_API_KEY` fallback when no header is sent. Every `POST`, `GET` and `DELETE` on `/mcp` must present the same credential from the same source:

- A request without any credential (no header and no server fallback) returns `401`.
- A request with a different key, or switching between header key and server fallback, is treated exactly like an unknown session and never touches the existing session.

Sessions expire after **30 minutes of inactivity** or **12 hours after creation**, whichever comes first. Clients must then initialize a new session.

#### Session admission

A new session is created only after the API key (header or server fallback) is confirmed by the Platfone API (`GET /user/balance`). Checks apply only to `initialize` requests; traffic on established sessions is not affected.

| Condition                                                        | Response |
| ---------------------------------------------------------------- | -------- |
| No credential                                                    | `401`    |
| Key rejected by the Platfone API                                 | `401`    |
| More than 30 new sessions per minute from one client address     | `429` + `Retry-After` |
| More than 20 active sessions for one API key                     | `429`    |
| Session pool full (5000 sessions)                                | `503`    |
| Platfone API unavailable, slow (> 5 s) or too many checks in flight | `503` + `Retry-After` |

Check results are cached for 60 seconds per key fingerprint (plaintext keys are never stored or logged). If the Platfone API later rejects a key with `401` during a tool call, every session of that key is closed.

---

## Automated Tests

```bash
npm test
```

Runs the HTTP transport tests against a local fake Platfone API (no network access or real API key required).

---

## End-to-End Test

1. `order_number` → get `activation_id`
2. Send SMS via sandbox [dashboard](https://platfone.com/test/app)
3. `check_sms` → receive code

If this works, the MCP server is functioning correctly.
