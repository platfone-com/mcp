import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GARBAGE_KEY,
  KEY_A,
  KEY_B,
  SERVER_KEY,
  assertNoSecretsLogged,
  balanceCalls,
  balanceText,
  deleteSession,
  getBalance,
  initialize,
  metricValue,
  openSession,
  setup
} from './helpers.ts'

const IP_HEADER = 'x-test-client-ip'
const fromIp = (ip: string) => ({ [IP_HEADER]: ip })
const nonUpstreamBalanceCalls = (calls: { path: string }[]) => calls.filter((c) => c.path !== '/user/balance')

describe('HTTP session admission', () => {
  it('rejects an invalid key before allocating a session or warming the catalog', async (t) => {
    const h = await setup(t)

    const res = await initialize(h.mcpUrl, GARBAGE_KEY)

    assert.equal(res.status, 401)
    assert.equal(res.sessionId, undefined)
    assert.equal(h.app.sessions.size, 0)
    assert.deepEqual(balanceCalls(h), [GARBAGE_KEY])
    assert.deepEqual(nonUpstreamBalanceCalls(h.calls), [])
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="invalid_credentials"}'), 1)
    assert.equal(metricValue(h, 'mcp_pending_admissions'), 0)
    assertNoSecretsLogged(h)
  })

  it('rejects a missing key without calling the Platfone API', async (t) => {
    const h = await setup(t)

    assert.equal((await initialize(h.mcpUrl)).status, 401)
    assert.equal((await initialize(h.mcpUrl, '')).status, 401)
    assert.equal(h.app.sessions.size, 0)
    assert.deepEqual(h.calls, [])
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="missing_credentials"}'), 2)
  })

  it('verifies the server fallback key before admitting a session with it', async (t) => {
    const h = await setup(t, { serverApiKey: 'revoked-server-key' })

    assert.equal((await initialize(h.mcpUrl)).status, 401)
    assert.equal(h.app.sessions.size, 0)

    const sid = await openSession(h.mcpUrl, KEY_A)
    assert.ok(h.app.sessions.has(sid))
    assert.equal(h.logs.join('\n').includes('revoked-server-key'), false)
  })

  it('admits a valid key and caches the check for subsequent sessions', async (t) => {
    const h = await setup(t, { credentialCacheTtlMs: 10_000 })

    const first = await openSession(h.mcpUrl, KEY_A)
    const second = await openSession(h.mcpUrl, KEY_A)
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_A, first)), /Total:\s+\$10\.00/)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A])

    h.clock.now += 10_001
    await openSession(h.mcpUrl, KEY_A)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A, KEY_A])

    assert.equal(h.app.sessions.size, 3)
    assert.ok(h.app.sessions.has(second))
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="admitted"}'), 3)
    assert.equal(metricValue(h, 'mcp_credential_checks_total{result="valid",source="cache"}'), 1)
    assert.equal(metricValue(h, 'mcp_active_sessions'), 3)
  })

  it('caches rejected keys so repeats do not amplify upstream load', async (t) => {
    const h = await setup(t)

    for (let i = 0; i < 5; i++) assert.equal((await initialize(h.mcpUrl, GARBAGE_KEY)).status, 401)

    assert.deepEqual(balanceCalls(h), [GARBAGE_KEY])
    assert.equal(metricValue(h, 'mcp_credential_checks_total{result="invalid",source="cache"}'), 4)
  })

  it('keeps the pool available for a valid client during an invalid-key flood', async (t) => {
    const h = await setup(t, { maxSessions: 3, clientIpHeader: IP_HEADER, admissionRateLimit: 1_000 })

    const flood = await Promise.all(
      Array.from({ length: 50 }, (_, i) => initialize(h.mcpUrl, `garbage-${i}`, { extraHeaders: fromIp('10.0.0.66') }))
    )
    assert.ok(flood.every((r) => r.status === 401 || r.status === 503))
    assert.equal(h.app.sessions.size, 0)
    assert.equal(metricValue(h, 'mcp_pending_admissions'), 0)

    const sid = await openSession(h.mcpUrl, KEY_A, fromIp('10.0.0.1'))
    assert.match(balanceText(await getBalance(h.mcpUrl, KEY_A, sid)), /Total:\s+\$10\.00/)
  })

  it('rate limits session creation per client address independently of established sessions', async (t) => {
    const h = await setup(t, { clientIpHeader: IP_HEADER, admissionRateLimit: 3, admissionRateWindowMs: 60_000 })
    const sid = await openSession(h.mcpUrl, KEY_A, fromIp('10.0.0.66'))

    for (let i = 0; i < 2; i++) await initialize(h.mcpUrl, `garbage-${i}`, { extraHeaders: fromIp('10.0.0.66') })
    const limited = await initialize(h.mcpUrl, KEY_A, { extraHeaders: fromIp('10.0.0.66') })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)

    for (let i = 0; i < 5; i++) assert.equal((await getBalance(h.mcpUrl, KEY_A, sid)).status, 200)
    assert.equal((await initialize(h.mcpUrl, KEY_B, { extraHeaders: fromIp('10.0.0.2') })).status, 200)

    h.clock.now += 60_000
    assert.equal((await initialize(h.mcpUrl, KEY_A, { extraHeaders: fromIp('10.0.0.66') })).status, 200)
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="rate_limited"}'), 1)
    assertNoSecretsLogged(h, [sid])
    assert.equal(h.app.renderMetrics().includes('10.0.0.66'), false)
  })

  it('caps active sessions per account without blocking other accounts', async (t) => {
    const h = await setup(t, { maxSessionsPerAccount: 2 })
    const first = await openSession(h.mcpUrl, KEY_A)
    await openSession(h.mcpUrl, KEY_A)

    const third = await initialize(h.mcpUrl, KEY_A)
    assert.equal(third.status, 429)
    assert.equal((await initialize(h.mcpUrl, KEY_B)).status, 200)

    assert.equal((await deleteSession(h.mcpUrl, KEY_A, first)).status, 200)
    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 200)
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="account_limit"}'), 1)
    assert.equal(metricValue(h, 'mcp_sessions_closed_total{reason="closed"}'), 1)
  })

  it('returns 503 when the global session pool is full', async (t) => {
    const h = await setup(t, { maxSessions: 1 })
    await openSession(h.mcpUrl, KEY_A)

    assert.equal((await initialize(h.mcpUrl, KEY_B)).status, 503)
    assert.deepEqual(balanceCalls(h), [KEY_A])
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="capacity"}'), 1)
  })

  it('fails closed with 503 when the Platfone API errors and does not cache the failure', async (t) => {
    const h = await setup(t)
    h.upstream.balanceStatus = 502

    const res = await initialize(h.mcpUrl, KEY_A)
    assert.equal(res.status, 503)
    assert.equal(res.headers.get('retry-after'), '5')
    assert.equal(h.app.sessions.size, 0)

    h.upstream.balanceStatus = undefined
    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 200)
    assert.deepEqual(balanceCalls(h), [KEY_A, KEY_A])
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="upstream_unavailable"}'), 1)
    assertNoSecretsLogged(h)
  })

  it('treats an edge 403 as an outage instead of an invalid key', async (t) => {
    const h = await setup(t)
    h.upstream.balanceStatus = 403

    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 503)
    h.upstream.balanceStatus = undefined
    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 200)
  })

  it('uses the proxy-appended address so a spoofed X-Forwarded-For prefix cannot reset the limit', async (t) => {
    const h = await setup(t, { clientIpHeader: 'x-forwarded-for', admissionRateLimit: 2 })
    const spoofed = (i: number) => ({ 'x-forwarded-for': `198.51.100.${i}, 203.0.113.9` })

    for (let i = 0; i < 2; i++) await initialize(h.mcpUrl, GARBAGE_KEY, { extraHeaders: spoofed(i) })
    assert.equal((await initialize(h.mcpUrl, KEY_A, { extraHeaders: spoofed(99) })).status, 429)
  })

  it('groups IPv6 clients by /64 for the session-creation limit', async (t) => {
    const h = await setup(t, { clientIpHeader: IP_HEADER, admissionRateLimit: 2 })

    await initialize(h.mcpUrl, GARBAGE_KEY, { extraHeaders: fromIp('2001:db8:1:2::1') })
    await initialize(h.mcpUrl, GARBAGE_KEY, { extraHeaders: fromIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd') })
    assert.equal((await initialize(h.mcpUrl, KEY_A, { extraHeaders: fromIp('2001:0db8:0001:0002::ffff') })).status, 429)
    assert.equal((await initialize(h.mcpUrl, KEY_A, { extraHeaders: fromIp('2001:db8:1:3::1') })).status, 200)
  })

  it('fails closed with 503 when the Platfone API times out', async (t) => {
    const h = await setup(t, { credentialCheckTimeoutMs: 100 })
    h.upstream.balanceDelayMs = 1_000

    const started = Date.now()
    const res = await initialize(h.mcpUrl, KEY_A)

    assert.equal(res.status, 503)
    assert.ok(Date.now() - started < 900)
    assert.equal(h.app.sessions.size, 0)
    assert.equal(metricValue(h, 'mcp_pending_admissions'), 0)
  })

  it('fails closed with 503 when the Platfone API is unreachable', async (t) => {
    const h = await setup(t, { baseUrl: 'http://127.0.0.1:1' })

    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 503)
    assert.equal(h.app.sessions.size, 0)
  })

  it('bounds concurrent upstream checks and coalesces checks for the same key', async (t) => {
    const h = await setup(t, { maxConcurrentCredentialChecks: 1 })
    h.upstream.balanceDelayMs = 150

    const [a1, a2, b] = await Promise.all([
      initialize(h.mcpUrl, KEY_A),
      initialize(h.mcpUrl, KEY_A),
      new Promise((r) => setTimeout(r, 30)).then(() => initialize(h.mcpUrl, KEY_B))
    ])

    assert.equal(a1.status, 200)
    assert.equal(a2.status, 200)
    assert.equal(b.status, 503)
    assert.deepEqual(balanceCalls(h), [KEY_A])
    assert.equal(metricValue(h, 'mcp_credential_checks_total{result="busy",source="limiter"}'), 1)
    assert.equal(metricValue(h, 'mcp_credential_checks_total{result="valid",source="coalesced"}'), 1)
  })

  it('releases the reservation when the client disconnects during the credential check', async (t) => {
    const h = await setup(t, { maxSessions: 1, maxSessionsPerAccount: 1 })
    h.upstream.balanceDelayMs = 200

    await assert.rejects(initialize(h.mcpUrl, KEY_A, { signal: AbortSignal.timeout(50) }))
    await new Promise((r) => setTimeout(r, 300))

    assert.equal(h.app.sessions.size, 0)
    assert.equal(metricValue(h, 'mcp_pending_admissions'), 0)
    assert.equal(metricValue(h, 'mcp_session_admissions_total{result="aborted"}'), 1)

    h.upstream.balanceDelayMs = 0
    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 200)
  })

  it('drops every session of a key once the Platfone API reports it revoked', async (t) => {
    const h = await setup(t)
    const first = await openSession(h.mcpUrl, KEY_A)
    const second = await openSession(h.mcpUrl, KEY_A)
    const other = await openSession(h.mcpUrl, KEY_B)

    h.upstream.balances.delete(KEY_A)
    const call = await getBalance(h.mcpUrl, KEY_A, first)
    assert.equal(call.body?.result?.isError, true)

    assert.equal((await getBalance(h.mcpUrl, KEY_A, first)).status, 400)
    h.app.sweepExpiredSessions()
    assert.equal(h.app.sessions.has(second), false)
    assert.ok(h.app.sessions.has(other))

    assert.equal((await initialize(h.mcpUrl, KEY_A)).status, 401)
    assert.equal(metricValue(h, 'mcp_sessions_closed_total{reason="revoked"}'), 2)
  })

  it('exposes metrics without credentials, session ids or client addresses', async (t) => {
    const h = await setup(t, { serverApiKey: SERVER_KEY, clientIpHeader: IP_HEADER })
    const sid = await openSession(h.mcpUrl, KEY_A, fromIp('203.0.113.7'))
    await initialize(h.mcpUrl, GARBAGE_KEY)

    const text = h.app.renderMetrics()
    assert.match(text, /# TYPE mcp_session_admissions_total counter/)
    assert.match(text, /mcp_active_sessions 1/)
    assert.equal(text.includes('203.0.113.7'), false)
    assertNoSecretsLogged(h, [sid])
  })
})
