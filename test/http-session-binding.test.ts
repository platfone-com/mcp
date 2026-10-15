import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GARBAGE_KEY,
  KEY_A,
  KEY_B,
  PROTOCOL_VERSION,
  SERVER_KEY,
  assertNoSecretsLogged,
  balanceCalls,
  balanceText,
  deleteSession,
  getBalance,
  initialize,
  openSession,
  setup
} from './helpers.ts'

// The first `/user/balance` call of each new session is the admission credential check.
describe('HTTP transport session binding', () => {
  it('lets the owner reuse its session with its own account key', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    const first = await getBalance(h.mcpUrl, KEY_A, sid)
    const second = await getBalance(h.mcpUrl, KEY_A, sid)

    assert.equal(first.status, 200)
    assert.match(balanceText(first), /Total:\s+\$10\.00/)
    assert.match(balanceText(second), /Total:\s+\$10\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A, KEY_A])
    assertNoSecretsLogged(h, [sid])
  })

  it('rejects another valid account on POST without touching the victim session', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)
    const lastActivity = h.app.sessions.get(sid)!.lastActivity

    h.clock.now += 30_000
    const attack = await getBalance(h.mcpUrl, KEY_B, sid)

    assert.equal(attack.status, 400)
    assert.equal(attack.body?.result, undefined)
    assert.deepEqual(balanceCalls(h), [KEY_A])
    assert.equal(h.app.sessions.get(sid)?.lastActivity, lastActivity)

    const owner = await getBalance(h.mcpUrl, KEY_A, sid)
    assert.match(balanceText(owner), /Total:\s+\$10\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A])
    assertNoSecretsLogged(h, [sid])
  })

  it('rejects a garbage key and isolates a different-account initialize on an existing session id', async (t) => {
    const h = await setup(t)
    const sid = await openSession(h.mcpUrl, KEY_A)

    const garbage = await getBalance(h.mcpUrl, GARBAGE_KEY, sid)
    assert.equal(garbage.status, 400)

    const reinit = await initialize(h.mcpUrl, KEY_B, { extraHeaders: { 'mcp-session-id': sid } })
    assert.equal(reinit.status, 200)
    assert.ok(reinit.sessionId)
    assert.notEqual(reinit.sessionId, sid)

    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_A, sid)), /Total:\s+\$10\.00/)
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_B, reinit.sessionId)), /Total:\s+\$20\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_B, KEY_A, KEY_B])
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
    assert.deepEqual(balanceCalls(h), [KEY_A])
  })

  it('does not let the server fallback key operate a session opened with a caller key', async (t) => {
    const h = await setup(t, { serverApiKey: SERVER_KEY })
    const sid = await openSession(h.mcpUrl, KEY_A)

    assert.equal((await getBalance(h.mcpUrl, undefined, sid)).status, 400)
    assert.equal((await deleteSession(h.mcpUrl, undefined, sid)).status, 400)
    assert.ok(h.app.sessions.has(sid))
    assert.deepEqual(balanceCalls(h), [KEY_A])
  })

  it('preserves the server-key fallback without letting a caller key take it over', async (t) => {
    const h = await setup(t, { serverApiKey: SERVER_KEY })
    const sid = await openSession(h.mcpUrl)

    assert.match(balanceText(await getBalance(h.mcpUrl, undefined, sid)), /Total:\s+\$30\.00/)
    assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 400)
    assert.deepEqual(balanceCalls(h), [SERVER_KEY, SERVER_KEY])
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
    h.clock.now += 30_000

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
    assert.deepEqual(balanceCalls(h), [KEY_A])
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
