import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { PlatfoneClient } from '../platfone/client.ts'
import { createMcpServer } from './setup.ts'

export async function startStdio() {
  const apiKey = process.env.PLATFONE_API_KEY
  if (!apiKey) {
    console.error('PLATFONE_API_KEY environment variable is required for stdio transport.')
    process.exit(1)
  }

  const client = new PlatfoneClient({
    apiKey,
    baseUrl: process.env.PLATFONE_API_URL
  })

  const { server, catalog } = createMcpServer(client)

  catalog.warmUp().catch(() => {})

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Platfone MCP server running on stdio')
}
