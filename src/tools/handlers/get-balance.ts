import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { formatError } from '../helpers.ts'

export function registerGetBalance(server: McpServer, client: PlatfoneClient) {
  server.registerTool(
    'get_balance',
    {
      title: 'Get Balance',
      description:
        'Returns the current Platfone account balance: total available funds and the amount reserved by active orders. All values are in USD cents. Use this after a 402 error to inform the user how much they need to top up.',
      inputSchema: {},
      annotations: {
        title: 'Get Balance',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => {
      try {
        const balance = await client.getBalance()

        const available = balance.total - balance.reserved
        const text = [
          `💰 Account Balance`,
          `Total:     $${(balance.total / 100).toFixed(2)}`,
          `Reserved:  $${(balance.reserved / 100).toFixed(2)}`,
          `Available: $${(available / 100).toFixed(2)}`
        ].join('\n')

        return { content: [{ type: 'text', text }] }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}

