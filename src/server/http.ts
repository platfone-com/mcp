import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { PlatfoneClient } from '../platfone/client.ts'
import { createMcpServer } from './setup.ts'

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_SESSIONS = 5000

export async function startHttp(port: number) {
  const app = express()
  app.use(express.json())

  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer; lastActivity: number }
  >()

  app.post('/mcp', async (req, res) => {
    try {
      const raw = req.headers['x-api-key']
      const apiKey = (Array.isArray(raw) ? raw[0] : raw) || process.env.PLATFONE_API_KEY
      if (!apiKey) {
        res.status(401).json({ error: 'Missing API key. Pass x-api-key header or set PLATFONE_API_KEY.' })
        return
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        session.lastActivity = Date.now()
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      if (sessions.size >= MAX_SESSIONS) {
        res.status(503).json({ error: 'Too many active sessions. Try again later.' })
        return
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          const client = new PlatfoneClient({ apiKey, baseUrl: process.env.PLATFONE_API_URL })
          const { server, catalog } = createMcpServer(client)
          sessions.set(id, { transport, server, lastActivity: Date.now() })
          void server.connect(transport)

          catalog.warmUp().catch((err) => console.error('Catalog warm-up failed:', err.message))
        }
      })

      transport.onclose = () => {
        const id = transport.sessionId
        if (id) sessions.delete(id)
      }

      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('POST /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  app.get('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session. Start with POST /mcp.' })
        return
      }
      const session = sessions.get(sessionId)!
      session.lastActivity = Date.now()
      await session.transport.handleRequest(req, res)
    } catch (err) {
      console.error('GET /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  app.delete('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session.' })
        return
      }
      const session = sessions.get(sessionId)!
      await session.transport.handleRequest(req, res)
      sessions.delete(sessionId)
    } catch (err) {
      console.error('DELETE /mcp error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
    }
  })

  setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        void session.transport.close()
        sessions.delete(id)
      }
    }
  }, 60_000).unref()

  app.listen(port, () => {
    console.error(`Platfone MCP server running on http://localhost:${port}/mcp`)
  })
}
