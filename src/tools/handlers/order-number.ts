import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { CatalogCache } from '../../platfone/catalog-cache.ts'
import { PlatfoneApiError } from '../../platfone/types.ts'
import {
  formatCancelability,
  formatError,
  humanReadableExpiry,
  isToolError,
  resolveCountryAndService
} from '../helpers.ts'

export function registerOrderNumber(server: McpServer, client: PlatfoneClient, catalog: CatalogCache) {
  let orderInFlight = false

  server.registerTool(
    'order_number',
    {
      title: 'Order Number',
      description:
        'Rent a virtual phone number via the Platfone API for the given country and service category. Returns phone number, activation_id, resolved country & service names, price, expiry time, retriable flag, and whether/when the activation can be canceled. Accepts country and service as human-readable names or IDs — names are auto-resolved from the cached catalog. Use check_price first to verify cost and availability. Use check_sms with the activation_id to poll for incoming SMS. Only received messages are billed. IMPORTANT: Only call this tool once per order. Never call it multiple times in parallel — duplicate orders will be rejected.',
      inputSchema: {
        country: z.string().max(256).describe("Country name or ID (e.g. 'us', 'United Kingdom')."),
        service: z.string().max(256).describe('Service category name or ID from the Platfone catalog.'),
        max_price: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum price in USD cents you're willing to pay. Protects against price changes."),
        quality_factor: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe('Quality vs price preference: 0 = cheapest, 50 = balanced (default), 100 = highest quality.')
      },
      annotations: {
        title: 'Order Number',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ country, service, max_price, quality_factor }) => {
      if (orderInFlight) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ An order is already in progress. Wait for it to complete before placing another. Do NOT call order_number multiple times in parallel.'
            }
          ],
          isError: true
        }
      }

      orderInFlight = true
      try {
        const resolved = await resolveCountryAndService(catalog, country, service)
        if (isToolError(resolved)) return resolved

        const activation = await client.orderNumber({
          service_id: resolved.service.service_id,
          country_id: resolved.country.country_id,
          max_price,
          quality_factor
        })

        const text = [
          `✅ Number ordered!`,
          `📱 +${activation.phone} | 🆔 ${activation.activation_id}`,
          `🌍 ${resolved.country.name} | 🏷️ ${resolved.service.name}`,
          `💰 $${(activation.price / 100).toFixed(2)} | ⏰ ${humanReadableExpiry(activation.expire_at)}`,
          `🔄 Retriable: ${activation.is_retriable ? 'Yes' : 'No'}`,
          formatCancelability(activation.cancelable_after),
          ``,
          `Use check_sms to poll for SMS or check once on demand.`
        ].join('\n')

        return { content: [{ type: 'text', text }] }
      } catch (err) {
        if (err instanceof PlatfoneApiError && err.status === 409 && err.body) {
          const suggestedPrice = err.body.suggestedPrice as number | undefined
          const orderId = err.body.orderId as string | undefined
          const lines = [
            `⚠️ Max price exceeded.`,
            suggestedPrice != null ? `Suggested price: ${suggestedPrice} cents (USD)` : '',
            orderId ? `Order ID for retry: ${orderId}` : '',
            `Retry order_number with a higher max_price and the order_id above.`
          ].filter(Boolean)
          return { content: [{ type: 'text', text: lines.join('\n') }], isError: true }
        }
        return formatError(err)
      } finally {
        orderInFlight = false
      }
    }
  )
}
