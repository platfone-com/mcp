import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { formatError } from '../helpers.ts'

export function registerCancelActivation(server: McpServer, client: PlatfoneClient) {
  server.registerTool(
    'cancel_activation',
    {
      title: 'Cancel Activation',
      description:
        'Cancel a Platfone activation and release the phone number. Allowed when activation_status is "active", sms_status is "smsRequested", and the cancelable_after timestamp has passed. If cancelable_after is null, cancellation is not supported.',
      inputSchema: {
        activation_id: z.string().describe('Activation ID to cancel.')
      },
      annotations: {
        title: 'Cancel Activation',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ activation_id }) => {
      try {
        await client.cancelActivation(activation_id)
        return { content: [{ type: 'text', text: `🚫 Activation ${activation_id} canceled. Funds will be refunded.` }] }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}

