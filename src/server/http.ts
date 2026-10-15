import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express, { type Request, type Response } from 'express'
import { PlatfoneClient } from '../platfone/client.ts'
import { createMcpServer } from './setup.ts'
import { isSamePrincipal, resolvePrincipal, type Principal } from './session-auth.ts'

export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000 // 30 minutes
export const SESSION_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000 // 12 hours
const MAX_SESSIONS = 5000
const SWEEP_INTERVAL_MS = 60_000

interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
  owner: Buffer
  createdAt: number
  lastActivity: number
}

export interface HttpAppOptions {
  /** Server-side fallback key used when the caller sends no `x-api-key` header. */
  serverApiKey?: string
  baseUrl?: string
  idleTtlMs?: number
  maxLifetimeMs?: number
  maxSessions?: number
  now?: () => number
}

export function createHttpApp(options: HttpAppOptions = {}) {
  const {
    serverApiKey,
    baseUrl,
    idleTtlMs = SESSION_IDLE_TTL_MS,
    maxLifetimeMs = SESSION_MAX_LIFETIME_MS,
    maxSessions = MAX_SESSIONS,
    now = Date.now
  } = options

  const app = express()
  app.use(express.json())

  const sessions = new Map<string, Session>()

  const isExpired = (session: Session, at: number) =>
    at - session.lastActivity > idleTtlMs || at - session.createdAt > maxLifetimeMs

  function expire(id: string, session: Session) {
    sessions.delete(id)
    void session.transport.close()
  }

  function authenticate(req: Request, res: Response): Principal | null {
    const principal = resolvePrincipal(req.headers, serverApiKey)
    if (!principal) {
      res.status(401).json({ error: 'Missing API key. Pass x-api-key header or set PLATFONE_API_KEY.' })
    }
    return principal
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
    if (isExpired(session, at)) {
      expire(id, session)
      return undefined
    }

    session.lastActivity = at
    return session
  }

  app.post('/mcp', async (req, res) => {
    try {
      const principal = authenticate(req, res)
      if (!principal) return

      const session = findOwnedSession(req, principal)
      if (session) {
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      if (sessions.size >= maxSessions) {
        res.status(503).json({ error: 'Too many active sessions. Try again later.' })
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          const client = new PlatfoneClient({ apiKey: principal.apiKey, baseUrl })
          const { server, catalog } = createMcpServer(client)
          const at = now()
          sessions.set(id, { transport, server, owner: principal.fingerprint, createdAt: at, lastActivity: at })
          void server.connect(transport)

          catalog.warmUp().catch((err) => console.error('Catalog warm-up failed:', err.message))
        }
      })

      transport.onclose = () => {
        const id = transport.sessionId
        if (id && sessions.get(id)?.transport === transport) sessions.delete(id)
      }

      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('POST /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  app.get('/mcp', async (req, res) => {
    try {
      const principal = authenticate(req, res)
      if (!principal) return

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
      const principal = authenticate(req, res)
      if (!principal) return

      const session = findOwnedSession(req, principal)
      if (!session) {
        res.status(400).json({ error: 'Invalid or missing session.' })
        return
      }
      const id = session.transport.sessionId
      await session.transport.handleRequest(req, res)
      if (id) sessions.delete(id)
    } catch (err) {
      console.error('DELETE /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  function sweepExpiredSessions() {
    const at = now()
    for (const [id, session] of sessions) {
      if (isExpired(session, at)) expire(id, session)
    }
  }

  async function closeAllSessions() {
    const all = [...sessions.values()]
    sessions.clear()
    await Promise.all(all.map((session) => session.transport.close()))
  }

  return { app, sessions, sweepExpiredSessions, closeAllSessions }
}

export async function startHttp(port: number) {
  const { app, sweepExpiredSessions } = createHttpApp({
    serverApiKey: process.env.PLATFONE_API_KEY,
    baseUrl: process.env.PLATFONE_API_URL
  })

  setInterval(sweepExpiredSessions, SWEEP_INTERVAL_MS).unref()

  app.listen(port, () => {
    console.error(`Platfone MCP server running on http://localhost:${port}/mcp`)
  })
}
