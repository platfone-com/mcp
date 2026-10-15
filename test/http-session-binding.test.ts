import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, type TestContext } from 'node:test'
import { createHttpApp, type HttpAppOptions } from '../src/server/http.ts'

const KEY_A = 'key-account-a'
const KEY_B = 'key-account-b'
const SERVER_KEY = 'key-server-fallback'
const GARBAGE_KEY = 'not-a-real-key'
const BALANCES: Record<string, number> = { [KEY_A]: 1000, [KEY_B]: 2000, [SERVER_KEY]: 3000 }
const PROTOCOL_VERSION = '2025-03-26'

interface UpstreamCall {
  path: string
  apiKey: string | undefined
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  })
}

function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

async function startUpstream() {
  const calls: UpstreamCall[] = []
  const server = createServer((req: IncomingMessage, res) => {
    const apiKey = req.headers['x-api-key'] as string | undefined
    const path = (req.url ?? '').replace(/\?.*$/, '')
    calls.push({ path, apiKey })
    res.setHeader('Content-Type', 'application/json')

    if (!apiKey || !(apiKey in BALANCES)) {
      res.statusCode = 401
      res.end(JSON.stringify({ errorName: 'UnauthorizedException', errorMessage: 'Unauthorized' }))
      return
    }
    if (path === '/user/balance') {
      res.end(JSON.stringify({ total: BALANCES[apiKey], reserved: 0 }))
      return
    }
    res.end('[]')
  })
  const url = await listen(server)
  return { url, calls, server }
}

interface Harness {
  mcpUrl: string
  calls: UpstreamCall[]
  logs: string[]
  clock: { now: number }
  app: ReturnType<typeof createHttpApp>
}

async function setup(t: TestContext, options: Partial<HttpAppOptions> = {}): Promise<Harness> {
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

  return { mcpUrl, calls: upstream.calls, logs, clock, app }
}

function headers(apiKey?: string, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  }
  if (apiKey !== undefined) h['x-api-key'] = apiKey
  if (sessionId) {
    h['mcp-session-id'] = sessionId
    h['mcp-protocol-version'] = PROTOCOL_VERSION
  }
  return h
}

let nextId = 1

async function rpc(
  url: string,
  apiKey: string | undefined,
  sessionId: string | undefined,
  method: string,
  params = {}
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  })
  const text = await res.text()
  const dataLine = text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .pop()
  const body = dataLine ? JSON.parse(dataLine.slice(6)) : text ? JSON.parse(text) : undefined
  return { status: res.status, body, sessionId: res.headers.get('mcp-session-id') ?? undefined }
}

async function openSession(url: string, apiKey?: string): Promise<string> {
  const init = await rpc(url, apiKey, undefined, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  })
  assert.equal(init.status, 200)
  assert.ok(init.sessionId)

  const notified = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey, init.sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  })
  assert.equal(notified.status, 202)
  return init.sessionId
}

function getBalance(url: string, apiKey: string | undefined, sessionId: string) {
  return rpc(url, apiKey, sessionId, 'tools/call', { name: 'get_balance', arguments: {} })
}

function balanceText(result: Awaited<ReturnType<typeof getBalance>>): string {
  return result.body?.result?.content?.[0]?.text ?? ''
}

function balanceCalls(h: Harness): (string | undefined)[] {
  return h.calls.filter((c) => c.path === '/user/balance').map((c) => c.apiKey)
}

function deleteSession(url: string, apiKey: string | undefined, sessionId: string) {
  return fetch(url, { method: 'DELETE', headers: headers(apiKey, sessionId) })
}

function assertNoSecretsLogged(h: Harness, sessionIds: string[]) {
  const all = h.logs.join('\n')
  for (const secret of [KEY_A, KEY_B, SERVER_KEY, GARBAGE_KEY, ...sessionIds]) {
    assert.ok(!all.includes(secret), 'logs must not contain API keys or session IDs')
  }
}

describe('HTTP transport session binding', () => {
  it('lets the owner reuse its session with its own account key', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    const first = await getBalance(h.mcpUrl, KEY_A, sid)
    const second = await getBalance(h.mcpUrl, KEY_A, sid)

    assert.equal(first.status, 200)
    assert.match(balanceText(first), /Total:\s+\$10\.00/)
    assert.match(balanceText(second), /Total:\s+\$10\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A])
    assertNoSecretsLogged(h, [sid])
  })

  it('rejects another valid account on POST without touching the victim session', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)
    const lastActivity = h.app.sessions.get(sid)!.lastActivity

    h.clock.now += 60_000
    const attack = await getBalance(h.mcpUrl, KEY_B, sid)

    assert.equal(attack.status, 400)
    assert.equal(attack.body?.result, undefined)
    assert.deepEqual(balanceCalls(h), [])
    assert.equal(h.app.sessions.get(sid)?.lastActivity, lastActivity)

    const owner = await getBalance(h.mcpUrl, KEY_A, sid)
    assert.match(balanceText(owner), /Total:\s+\$10\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A])
    assertNoSecretsLogged(h, [sid])
  })

  it('rejects a garbage key and isolates a different-account initialize on an existing session id', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    const garbage = await getBalance(h.mcpUrl, GARBAGE_KEY, sid)
    assert.equal(garbage.status, 400)

    const reinit = await rpc(h.mcpUrl, KEY_B, sid, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'other', version: '1.0.0' }
    })
    assert.equal(reinit.status, 200)
    assert.ok(reinit.sessionId)
    assert.notEqual(reinit.sessionId, sid)

    assert.deepEqual(balanceCalls(h), [])
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_A, sid)), /Total:\s+\$10\.00/)
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_B, reinit.sessionId)), /Total:\s+\$20\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_B])
    assertNoSecretsLogged(h, [sid, reinit.sessionId])
  })

  it('returns 401 for a missing key when no server fallback is configured', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    const post = await getBalance(h.mcpUrl, undefined, sid)
    const emptyKey = await getBalance(h.mcpUrl, '', sid)
    const get = await fetch(h.mcpUrl, { headers: { 'Accept': 'text/event-stream', 'mcp-session-id': sid } })
    const del = await deleteSession(h.mcpUrl, undefined, sid)

    assert.equal(post.status, 401)
    assert.equal(emptyKey.status, 401)
    assert.equal(get.status, 401)
    assert.equal(del.status, 401)
    assert.ok(h.app.sessions.has(sid))
    assert.deepEqual(balanceCalls(h), [])
  })

  it('does not let the server fallback key operate a session opened with a caller key', async (t) => {
    const h = await setup(t, { serverApiKey: SERVER_KEY })
    const sid = await openSession(h.mcpUrl, KEY_A)

    assert.equal((await getBalance(h.mcpUrl, undefined, sid)).status, 400)
    assert.equal((await deleteSession(h.mcpUrl, undefined, sid)).status, 400)
    assert.ok(h.app.sessions.has(sid))
    assert.deepEqual(balanceCalls(h), [])
  })

  it('preserves the server-key fallback without letting a caller key take it over', async (t) => {
    const h = await setup(t, { serverApiKey: SERVER_KEY })
    const sid = await openSession(h.mcpUrl)

    assert.match(balanceText(await getBalance(h.mcpUrl, undefined, sid)), /Total:\s+\$30\.00/)
    assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 400)
    assert.deepEqual(balanceCalls(h), [SERVER_KEY])
    assertNoSecretsLogged(h, [sid])
  })

  it('binds the GET stream to the session owner', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)
    const streamHeaders = (apiKey: string) => ({
      'Accept': 'text/event-stream',
      'x-api-key': apiKey,
      'mcp-session-id': sid,
      'mcp-protocol-version': PROTOCOL_VERSION
    })

    const lastActivity = h.app.sessions.get(sid)!.lastActivity
    h.clock.now += 60_000

    for (const key of [KEY_B, GARBAGE_KEY]) {
      const res = await fetch(h.mcpUrl, { headers: streamHeaders(key) })
      assert.equal(res.status, 400)
      assert.doesNotMatch(res.headers.get('content-type') ?? '', /text\/event-stream/)
      await res.body?.cancel()
    }
    assert.equal(h.app.sessions.get(sid)!.lastActivity, lastActivity)

    const controller = new AbortController()
    const owner = await fetch(h.mcpUrl, { headers: streamHeaders(KEY_A), signal: controller.signal })
    assert.equal(owner.status, 200)
    assert.match(owner.headers.get('content-type') ?? '', /text\/event-stream/)
    controller.abort()
  })

  it('binds DELETE to the session owner', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    for (const key of [KEY_B, GARBAGE_KEY]) {
      assert.equal((await deleteSession(h.mcpUrl, key, sid)).status, 400)
    }
    assert.ok(h.app.sessions.has(sid))
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_A, sid)), /Total:\s+\$10\.00/)

    assert.equal((await deleteSession(h.mcpUrl, KEY_A, sid)).status, 200)
    assert.equal(h.app.sessions.has(sid), false)
    assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 400)
    assertNoSecretsLogged(h, [sid])
  })

  it('expires sessions after the idle timeout', async (t) => {
    const h = await setup(t, { idleTtlMs: 1_000, maxLifetimeMs: 60_000 })
    const sid = await openSession(h.mcpUrl, KEY_A)

    h.clock.now += 1_001
    assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 400)
    assert.equal(h.app.sessions.has(sid), false)
    assert.deepEqual(balanceCalls(h), [])
  })

  it('expires active sessions after the absolute lifetime', async (t) => {
    const h = await setup(t, { idleTtlMs: 1_000, maxLifetimeMs: 2_500 })
    const sid = await openSession(h.mcpUrl, KEY_A)

    for (let i = 0; i < 2; i++) {
      h.clock.now += 900
      assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 200)
    }

    h.clock.now += 900
    assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 400)
    assert.equal(h.app.sessions.has(sid), false)
  })

  it('sweeps idle and over-age sessions in the background', async (t) => {
    const h = await setup(t, { idleTtlMs: 1_000, maxLifetimeMs: 1_500 })
    const idle = await openSession(h.mcpUrl, KEY_A)
    const old = await openSession(h.mcpUrl, KEY_A)
    h.clock.now += 500
    const fresh = await openSession(h.mcpUrl, KEY_B)

    h.clock.now += 600
    h.app.sessions.get(old)!.lastActivity = h.clock.now
    h.app.sweepExpiredSessions()
    assert.equal(h.app.sessions.has(idle), false)
    assert.ok(h.app.sessions.has(old))
    assert.ok(h.app.sessions.has(fresh))

    h.clock.now += 401
    h.app.sessions.get(old)!.lastActivity = h.clock.now
    h.app.sessions.get(fresh)!.lastActivity = h.clock.now
    h.app.sweepExpiredSessions()
    assert.equal(h.app.sessions.has(old), false)
    assert.ok(h.app.sessions.has(fresh))
  })
})
