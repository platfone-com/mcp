import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { formatCancelability, formatError, formatSmsReceived, humanReadableExpiry } from '../helpers.ts'

export function registerCheckSms(server: McpServer, client: PlatfoneClient) {
  server.registerTool(
    'check_sms',
    {
      title: 'Check SMS',
      description:
        'Retrieve the current state of a Platfone activation: SMS text, parsed code, status, and expiration. Can be used to poll periodically or check once on demand.',
      inputSchema: {
        activation_id: z.string().describe('Activation ID returned by order_number.')
      },
      annotations: {
        title: 'Check SMS',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ activation_id }) => {
      try {
        const activation = await client.getActivation(activation_id)

        if (activation.sms_status === 'smsReceived' || activation.sms_status === 'retryReceived') {
          return { content: [{ type: 'text', text: formatSmsReceived(activation) }] }
        }

        if (activation.activation_status === 'expired') {
          return {
            content: [{ type: 'text', text: `⏰ Expired — no SMS received. Use order_number for a new number.` }],
            isError: true
          }
        }
        if (activation.activation_status === 'canceled') {
          return {
            content: [{ type: 'text', text: `❌ Canceled — no SMS will arrive. Use order_number for a new number.` }],
            isError: true
          }
        }
        if (activation.activation_status === 'finalized') {
          return {
            content: [{ type: 'text', text: `✔️ Finalized. Code: ${activation.sms_code ?? '(unavailable)'}` }]
          }
        }

        const lines = [
          `⏳ Waiting for SMS…`,
          `📱 +${activation.phone} | 🆔 ${activation.activation_id}`,
          `⏰ Expires: ${humanReadableExpiry(activation.expire_at)}`,
          formatCancelability(activation.cancelable_after)
        ]

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}
