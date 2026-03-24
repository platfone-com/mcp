import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { PlatfoneClient } from '../platfone/client.ts'
import { createMcpServer } from './setup.ts'

export async function startHttp(port: number) {
  const app = express()
  app.use(express.json())

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>()

  app.post('/mcp', async (req, res) => {
    const apiKey = (req.headers['x-api-key'] as string) || process.env.PLATFONE_API_KEY
    if (!apiKey) {
      res.status(401).json({ error: 'Missing API key. Pass x-api-key header or set PLATFONE_API_KEY.' })
      return
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!
      await session.transport.handleRequest(req, res, req.body)
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        const client = new PlatfoneClient({ apiKey, baseUrl: process.env.PLATFONE_API_URL })
        const { server, catalog } = createMcpServer(client)
        sessions.set(id, { transport, server })
        server.connect(transport)

        catalog.warmUp().catch(() => {})
      }
    })

    transport.onclose = () => {
      const id = transport.sessionId
      if (id) sessions.delete(id)
    }

    await transport.handleRequest(req, res, req.body)
  })

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session. Start with POST /mcp.' })
      return
    }
    const session = sessions.get(sessionId)!
    await session.transport.handleRequest(req, res)
  })

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session.' })
      return
    }
    const session = sessions.get(sessionId)!
    await session.transport.handleRequest(req, res)
    sessions.delete(sessionId)
  })

  app.listen(port, () => {
    console.error(`Platfone MCP server running on http://localhost:${port}/mcp`)
  })
}

