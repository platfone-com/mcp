import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express, { type Request, type Response } from 'express'
import { PlatfoneClient } from '../platfone/client.ts'
import { CredentialVerifier } from './credential-verifier.ts'
import { Metrics, type SessionCloseReason } from './metrics.ts'
import { FixedWindowRateLimiter, addressFromHeader, rateLimitKey } from './rate-limiter.ts'
import { createMcpServer } from './setup.ts'
import { isSamePrincipal, resolvePrincipal, type Principal } from './session-auth.ts'

export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000 // 30 minutes
export const SESSION_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000 // 12 hours
export const MAX_SESSIONS = 5000
export const MAX_SESSIONS_PER_ACCOUNT = 20
export const ADMISSION_RATE_LIMIT = 30
export const ADMISSION_RATE_WINDOW_MS = 60_000
const MAX_RATE_LIMIT_KEYS = 100_000
const SWEEP_INTERVAL_MS = 60_000
const UPSTREAM_RETRY_AFTER_S = 5

interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
  owner: Buffer
  account: string
  createdAt: number
  lastActivity: number
  revoked: boolean
}

export interface HttpAppOptions {
  /** Server-side fallback key used when the caller sends no `x-api-key` header. */
  serverApiKey?: string
  baseUrl?: string
  idleTtlMs?: number
  maxLifetimeMs?: number
  maxSessions?: number
  maxSessionsPerAccount?: number
  /** Session creations allowed per client address per window. */
  admissionRateLimit?: number
  admissionRateWindowMs?: number
  /** Header carrying the real client address, set by a trusted proxy (e.g. `cf-connecting-ip`). */
  clientIpHeader?: string
  credentialCheckTimeoutMs?: number
  maxConcurrentCredentialChecks?: number
  credentialCacheTtlMs?: number
  now?: () => number
}

function isInitialize(body: unknown): boolean {
  return Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body)
}

export function createHttpApp(options: HttpAppOptions = {}) {
  const {
    serverApiKey,
    baseUrl,
    idleTtlMs = SESSION_IDLE_TTL_MS,
    maxLifetimeMs = SESSION_MAX_LIFETIME_MS,
    maxSessions = MAX_SESSIONS,
    maxSessionsPerAccount = MAX_SESSIONS_PER_ACCOUNT,
    admissionRateLimit = ADMISSION_RATE_LIMIT,
    admissionRateWindowMs = ADMISSION_RATE_WINDOW_MS,
    clientIpHeader,
    now = Date.now
  } = options

  const app = express()
  app.use(express.json())

  const sessions = new Map<string, Session>()
  /** Active plus in-flight sessions per account fingerprint. */
  const accountSessions = new Map<string, number>()
  let pendingAdmissions = 0

  const metrics = new Metrics()
  const verifier = new CredentialVerifier({
    baseUrl,
    timeoutMs: options.credentialCheckTimeoutMs,
    maxConcurrent: options.maxConcurrentCredentialChecks,
    validTtlMs: options.credentialCacheTtlMs,
    invalidTtlMs: options.credentialCacheTtlMs,
    now
  })
  const admissionLimiter = new FixedWindowRateLimiter(
    admissionRateLimit,
    admissionRateWindowMs,
    MAX_RATE_LIMIT_KEYS,
    now
  )
  const ipHeader = clientIpHeader?.toLowerCase()

  const accountOf = (principal: Principal) => principal.fingerprint.toString('hex')

  function adjustAccount(account: string, delta: number) {
    const count = (accountSessions.get(account) ?? 0) + delta
    if (count > 0) accountSessions.set(account, count)
    else accountSessions.delete(account)
  }

  function removeSession(id: string, reason: SessionCloseReason): Session | undefined {
    const session = sessions.get(id)
    if (!session) return undefined
    sessions.delete(id)
    adjustAccount(session.account, -1)
    metrics.sessionClosed(reason)
    return session
  }

  function expire(id: string, reason: SessionCloseReason) {
    const session = removeSession(id, reason)
    if (session) void session.transport.close()
  }

  function expiryReason(session: Session, at: number): SessionCloseReason | null {
    if (session.revoked) return 'revoked'
    if (at - session.createdAt > maxLifetimeMs) return 'lifetime'
    if (at - session.lastActivity > idleTtlMs) return 'idle'
    return null
  }

  function revokeAccount(principal: Principal) {
    verifier.invalidate(principal)
    const account = accountOf(principal)
    for (const session of sessions.values()) {
      if (session.account === account) session.revoked = true
    }
  }

  function clientAddress(req: Request): string {
    const address = (ipHeader && addressFromHeader(req.headers[ipHeader])) || req.socket.remoteAddress || 'unknown'
    return rateLimitKey(address)
  }

  function rejectMissingKey(res: Response) {
    res.status(401).json({ error: 'Missing API key. Pass x-api-key header or set PLATFONE_API_KEY.' })
  }

  /**
   * Returns the live session addressed by `mcp-session-id` only if it belongs to the caller.
   * Unknown, expired and foreign sessions are indistinguishable, and a foreign lookup never
   * touches the owner's session state.
   */
  function findOwnedSession(req: Request, principal: Principal): Session | undefined {
    const id = req.headers['mcp-session-id']
    if (typeof id !== 'string' || !id) return undefined

    const session = sessions.get(id)
    if (!session || !isSamePrincipal(session.owner, principal)) return undefined

    const at = now()
    const reason = expiryReason(session, at)
    if (reason) {
      expire(id, reason)
      return undefined
    }

    session.lastActivity = at
    return session
  }

  /**
   * Admits a new session only after cheap local limits pass and the API key is confirmed
   * by the Platfone API. Slots are reserved while the check runs so concurrent admissions
   * cannot overshoot the global or per-account limits.
   */
  async function admit(req: Request, res: Response, principal: Principal) {
    const rate = admissionLimiter.take(clientAddress(req))
    if (!rate.allowed) {
      metrics.admission('rate_limited')
      res.set('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))))
      res.status(429).json({ error: 'Too many new sessions. Try again later.' })
      return
    }

    if (sessions.size + pendingAdmissions >= maxSessions) {
      metrics.admission('capacity')
      res.status(503).json({ error: 'Too many active sessions. Try again later.' })
      return
    }

    const account = accountOf(principal)
    if ((accountSessions.get(account) ?? 0) >= maxSessionsPerAccount) {
      metrics.admission('account_limit')
      res.status(429).json({ error: 'Too many active sessions for this API key. Close unused sessions and try again.' })
      return
    }

    pendingAdmissions++
    adjustAccount(account, 1)
    let reserved = true
    const release = (registered: boolean) => {
      if (!reserved) return
      reserved = false
      pendingAdmissions--
      if (!registered) adjustAccount(account, -1)
    }

    let clientGone = false
    let sessionId: string | undefined
    res.on('close', () => {
      if (res.writableFinished) return
      clientGone = true
      // The client never received the initialize response, so nobody can use this session.
      if (sessionId) expire(sessionId, 'aborted')
    })

    try {
      const check = await verifier.verify(principal)
      metrics.credentialCheck(check.status, check.source)

      if (check.status === 'invalid') {
        metrics.admission('invalid_credentials')
        res.status(401).json({ error: 'Invalid API key.' })
        return
      }
      if (check.status !== 'valid') {
        metrics.admission('upstream_unavailable')
        res.set('Retry-After', String(UPSTREAM_RETRY_AFTER_S))
        res.status(503).json({ error: 'Unable to verify API key right now. Try again later.' })
        return
      }
      if (clientGone) {
        metrics.admission('aborted')
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          const client = new PlatfoneClient({
            apiKey: principal.apiKey,
            baseUrl,
            onUnauthorized: () => revokeAccount(principal)
          })
          const { server, catalog } = createMcpServer(client)
          const at = now()
          sessions.set(id, {
            transport,
            server,
            owner: principal.fingerprint,
            account,
            createdAt: at,
            lastActivity: at,
            revoked: false
          })
          sessionId = id
          release(true)
          metrics.admission('admitted')
          void server.connect(transport)

          catalog.warmUp().catch((err) => console.error('Catalog warm-up failed:', err.message))
        }
      })

      transport.onclose = () => {
        const id = transport.sessionId
        if (id && sessions.get(id)?.transport === transport) removeSession(id, 'closed')
      }

      try {
        await transport.handleRequest(req, res, req.body)
      } catch (err) {
        if (sessionId) expire(sessionId, 'aborted')
        else void transport.close()
        throw err
      }
    } finally {
      release(false)
    }
  }

  app.post('/mcp', async (req, res) => {
    try {
      const initializing = isInitialize(req.body)
      const principal = resolvePrincipal(req.headers, serverApiKey)
      if (!principal) {
        if (initializing) metrics.admission('missing_credentials')
        rejectMissingKey(res)
        return
      }

      const session = findOwnedSession(req, principal)
      if (session) {
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      if (initializing) {
        await admit(req, res, principal)
        return
      }

      // Not an admission: a session-less transport rejects it exactly like an unknown session.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('POST /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  app.get('/mcp', async (req, res) => {
    try {
      const principal = resolvePrincipal(req.headers, serverApiKey)
      if (!principal) return rejectMissingKey(res)

      const session = findOwnedSession(req, principal)
      if (!session) {
        res.status(400).json({ error: 'Invalid or missing session. Start with POST /mcp.' })
        return
      }
      await session.transport.handleRequest(req, res)
    } catch (err) {
      console.error('GET /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  app.delete('/mcp', async (req, res) => {
    try {
      const principal = resolvePrincipal(req.headers, serverApiKey)
      if (!principal) return rejectMissingKey(res)

      const session = findOwnedSession(req, principal)
      if (!session) {
        res.status(400).json({ error: 'Invalid or missing session.' })
        return
      }
      const id = session.transport.sessionId
      await session.transport.handleRequest(req, res)
      if (id && sessions.get(id) === session) expire(id, 'closed')
    } catch (err) {
      console.error('DELETE /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  function sweepExpiredSessions() {
    const at = now()
    for (const [id, session] of sessions) {
      const reason = expiryReason(session, at)
      if (reason) expire(id, reason)
    }
    admissionLimiter.prune()
  }

  async function closeAllSessions() {
    const all = [...sessions.keys()].map((id) => removeSession(id, 'shutdown')!)
    await Promise.all(all.map((session) => session.transport.close()))
  }

  const renderMetrics = () => metrics.render({ activeSessions: sessions.size, pendingAdmissions })

  return { app, sessions, metrics, renderMetrics, sweepExpiredSessions, closeAllSessions }
}

function parsePort(name: string, value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number between 1 and 65535.`)
  }
  return port
}

export async function startHttp(port: number) {
  const metricsPort = parsePort('MCP_METRICS_PORT', process.env.MCP_METRICS_PORT)
  const http = createHttpApp({
    serverApiKey: process.env.PLATFONE_API_KEY,
    baseUrl: process.env.PLATFONE_API_URL,
    clientIpHeader: process.env.MCP_CLIENT_IP_HEADER || undefined
  })

  setInterval(http.sweepExpiredSessions, SWEEP_INTERVAL_MS).unref()

  http.app.listen(port, () => {
    console.error(`Platfone MCP server running on http://localhost:${port}/mcp`)
  })

  if (metricsPort) {
    const metricsApp = express()
    metricsApp.get('/metrics', (_req, res) => {
      res.type('text/plain; version=0.0.4').send(http.renderMetrics())
    })
    metricsApp.listen(metricsPort, () => {
      console.error(`Metrics available on http://localhost:${metricsPort}/metrics`)
    })
  }
}
