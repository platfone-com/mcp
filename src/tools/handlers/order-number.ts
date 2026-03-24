import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { CatalogCache } from '../../platfone/catalog-cache.ts'
import { PlatfoneApiError } from '../../platfone/types.ts'
import { formatError, humanReadableExpiry } from '../helpers.ts'

export function registerOrderNumber(server: McpServer, client: PlatfoneClient, catalog: CatalogCache) {
  server.registerTool(
    'order_number',
    {
      title: 'Order Number',
      description:
        'Rent a virtual phone number via the Platfone API for the given country and service category. Returns a phone number and activation_id. Accepts country and service as human-readable names or IDs — names are auto-resolved from the cached catalog. Use check_sms with the activation_id to poll for incoming SMS. Only received messages are billed.',
      inputSchema: {
        country: z.string().describe("Country name or ID (e.g. 'Ukraine', 'us', 'United Kingdom')."),
        service: z.string().describe('Service category name or ID from the Platfone catalog.'),
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
      try {
        const resolvedCountry = await catalog.resolveCountryId(country)
        if (!resolvedCountry) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Country "${country}" not found. Use list_countries to see available countries.`
              }
            ],
            isError: true
          }
        }

        const resolvedService = await catalog.resolveServiceId(service)
        if (!resolvedService) {
          return {
            content: [
              { type: 'text', text: `❌ Service "${service}" not found. Use list_services to see available services.` }
            ],
            isError: true
          }
        }

        const activation = await client.orderNumber({
          service_id: resolvedService.service_id,
          country_id: resolvedCountry.country_id,
          max_price,
          quality_factor
        })

        const text = [
          `✅ Number ordered!`,
          `📱 +${activation.phone} | 🆔 ${activation.activation_id}`,
          `💰 $${(activation.price / 100).toFixed(2)} | ⏰ ${humanReadableExpiry(activation.expire_at)}`,
          ``,
          `Poll check_sms every 5s until sms_status is "smsReceived" or expired.`
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
      }
    }
  )
}

