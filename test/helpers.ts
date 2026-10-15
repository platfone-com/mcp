import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TestContext } from 'node:test'
import { createHttpApp, type HttpAppOptions } from '../src/server/http.ts'

export const KEY_A = 'key-account-a'
export const KEY_B = 'key-account-b'
export const SERVER_KEY = 'key-server-fallback'
export const GARBAGE_KEY = 'not-a-real-key'
export const PROTOCOL_VERSION = '2025-03-26'

export interface UpstreamCall {
  path: string
  apiKey: string | undefined
}

export interface UpstreamBehavior {
  balances: Map<string, number>
  /** Overrides the status of every `/user/balance` response when set. */
  balanceStatus?: number
  balanceDelayMs: number
}

export function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  })
}

export function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

async function startUpstream() {
  const calls: UpstreamCall[] = []
  const behavior: UpstreamBehavior = {
    balances: new Map([
      [KEY_A, 1000],
      [KEY_B, 2000],
      [SERVER_KEY, 3000]
    ]),
    balanceDelayMs: 0
  }

  const server = createServer(async (req, res) => {
    const apiKey = req.headers['x-api-key'] as string | undefined
    const path = (req.url ?? '').replace(/\?.*$/, '')
    calls.push({ path, apiKey })
    res.setHeader('Content-Type', 'application/json')

    if (path === '/user/balance') {
      if (behavior.balanceDelayMs) await new Promise((r) => setTimeout(r, behavior.balanceDelayMs))
      if (behavior.balanceStatus) {
        res.statusCode = behavior.balanceStatus
        res.end(JSON.stringify({ errorName: 'Error', errorMessage: 'Upstream error' }))
        return
      }
    }
    if (!apiKey || !behavior.balances.has(apiKey)) {
      res.statusCode = 401
      res.end(JSON.stringify({ errorName: 'UnauthorizedException', errorMessage: 'Unauthorized' }))
      return
    }
    if (path === '/user/balance') {
      res.end(JSON.stringify({ total: behavior.balances.get(apiKey), reserved: 0 }))
      return
    }
    res.end('[]')
  })
  const url = await listen(server)
  return { url, calls, behavior, server }
}

export interface Harness {
  mcpUrl: string
  calls: UpstreamCall[]
  upstream: UpstreamBehavior
  logs: string[]
  clock: { now: number }
  app: ReturnType<typeof createHttpApp>
}

export async function setup(t: TestContext, options: Partial<HttpAppOptions> = {}): Promise<Harness> {
  const upstream = await startUpstream()
  const clock = { now: 1_000_000 }
  const app = createHttpApp({ baseUrl: upstream.url, now: () => clock.now, ...options })
  const server = createServer(app.app)
  const mcpUrl = `${await listen(server)}/mcp`

  const logs: string[] = []
  t.mock.method(console, 'error', (...args: unknown[]) => {
    logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '))
  })

  t.after(async () => {
    await app.closeAllSessions()
    await close(server)
    await close(upstream.server)
  })

  return { mcpUrl, calls: upstream.calls, upstream: upstream.behavior, logs, clock, app }
}

export function headers(
  apiKey?: string,
  sessionId?: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...extra
  }
  if (apiKey !== undefined) h['x-api-key'] = apiKey
  if (sessionId) {
    h['mcp-session-id'] = sessionId
    h['mcp-protocol-version'] = PROTOCOL_VERSION
  }
  return h
}

let nextId = 1

export interface RpcResult {
  status: number
  body: any
  sessionId: string | undefined
  headers: Headers
}

export async function rpc(
  url: string,
  apiKey: string | undefined,
  sessionId: string | undefined,
  method: string,
  params = {},
  init: { extraHeaders?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<RpcResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey, sessionId, init.extraHeaders),
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    signal: init.signal
  })
  const text = await res.text()
  const dataLine = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .pop()
  const body = dataLine ? JSON.parse(dataLine.slice(6)) : text ? JSON.parse(text) : undefined
  return { status: res.status, body, sessionId: res.headers.get('mcp-session-id') ?? undefined, headers: res.headers }
}

export function initialize(
  url: string,
  apiKey?: string,
  init: { extraHeaders?: Record<string, string>; signal?: AbortSignal } = {}
) {
  return rpc(
    url,
    apiKey,
    undefined,
    'initialize',
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    init
  )
}

export async function openSession(url: string, apiKey?: string, extraHeaders?: Record<string, string>) {
  const init = await initialize(url, apiKey, { extraHeaders })
  assert.equal(init.status, 200)
  assert.ok(init.sessionId)

  const notified = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey, init.sessionId, extraHeaders),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  })
  assert.equal(notified.status, 202)
  return init.sessionId
}

export function getBalance(url: string, apiKey: string | undefined, sessionId: string) {
  return rpc(url, apiKey, sessionId, 'tools/call', { name: 'get_balance', arguments: {} })
}

export function balanceText(result: RpcResult): string {
  return result.body?.result?.content?.[0]?.text ?? ''
}

/** Upstream `/user/balance` calls, which include both admission checks and `get_balance` tool calls. */
export function balanceCalls(h: Harness): (string | undefined)[] {
  return h.calls.filter((c) => c.path === '/user/balance').map((c) => c.apiKey)
}

export function deleteSession(url: string, apiKey: string | undefined, sessionId: string) {
  return fetch(url, { method: 'DELETE', headers: headers(apiKey, sessionId) })
}

export function assertNoSecretsLogged(h: Harness, sessionIds: (string | undefined)[] = []) {
  const all = [h.logs.join('\n'), h.app.renderMetrics()].join('\n')
  for (const secret of [KEY_A, KEY_B, SERVER_KEY, GARBAGE_KEY, ...sessionIds]) {
    if (secret) assert.ok(!all.includes(secret), 'logs and metrics must not contain API keys or session IDs')
  }
}

export function metricValue(h: Harness, series: string): number {
  const line = h.app
    .renderMetrics()
    .split('\n')
    .find((l) => l.startsWith(`${series} `))
  return line ? Number(line.slice(series.length + 1)) : 0
}
