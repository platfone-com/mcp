import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { formatError, humanReadableExpiry } from '../helpers.ts'

export function registerRetryActivation(server: McpServer, client: PlatfoneClient) {
  server.registerTool(
    'retry_activation',
    {
      title: 'Retry Activation',
      description:
        'Request an additional SMS on the same Platfone number. Overwrites the previous SMS data with the next message. Free of charge. Only possible when sms_status is "smsReceived" or "retryReceived", activation_status is "active", and is_retriable is true. After calling, poll check_sms every 5 seconds until sms_status becomes "retryReceived" or the activation expires.',
      inputSchema: {
        activation_id: z.string().describe('Activation ID to retry.')
      },
      annotations: {
        title: 'Retry Activation',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ activation_id }) => {
      try {
        await client.retryActivation(activation_id)
        const activation = await client.getActivation(activation_id)

        const text = [
          `🔄 Retry requested — awaiting new SMS.`,
          `📱 +${activation.phone} | 🆔 ${activation.activation_id}`,
          `⏰ Expires: ${humanReadableExpiry(activation.expire_at)}`,
          ``,
          `Use check_sms to poll for the new SMS or check once on demand.`
        ].join('\n')

        return { content: [{ type: 'text', text }] }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}
