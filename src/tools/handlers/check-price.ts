import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../../platfone/client.ts'
import { CatalogCache } from '../../platfone/catalog-cache.ts'
import { formatError, isToolError, resolveCountryAndService } from '../helpers.ts'

function cents(v: number): string {
  return `$${(v / 100).toFixed(2)}`
}

export function registerCheckPrice(server: McpServer, client: PlatfoneClient, catalog: CatalogCache) {
  server.registerTool(
    'check_price',
    {
      title: 'Check Price',
      description:
        'Check pricing for a country + service pair before ordering. Returns min, max, and suggested price, average quality score, and number of available phone numbers. Use this before order_number to verify cost and availability. Accepts country and service as human-readable names or IDs.',
      inputSchema: {
        country: z.string().describe("Country name or ID (e.g. 'us', 'United Kingdom')."),
        service: z.string().describe('Service category name or ID from the Platfone catalog.'),
        max_price: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional budget limit in USD cents. A warning is shown if the suggested price exceeds this.')
      },
      annotations: {
        title: 'Check Price',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ country, service, max_price }) => {
      try {
        const resolved = await resolveCountryAndService(catalog, country, service)
        if (isToolError(resolved)) return resolved

        const info = await client.getPrice(resolved.service.service_id, resolved.country.country_id)

        const lines = [
          `💲 Price check: ${resolved.service.name} in ${resolved.country.name}`,
          `  Min: ${cents(info.price.min)} | Max: ${cents(info.price.max)} | Suggested: ${cents(info.price.suggested)}`,
          `  Quality avg: ${info.quality.avg} | Available numbers: ${info.count.toLocaleString()}`
        ]

        if (max_price != null) {
          if (info.price.suggested > max_price) {
            lines.push(`  ⚠️ Suggested price ${cents(info.price.suggested)} exceeds your limit of ${cents(max_price)}.`)
          } else {
            lines.push(
              `  ✅ Suggested price ${cents(info.price.suggested)} is within your limit of ${cents(max_price)}.`
            )
          }
        }

        if (info.count === 0) {
          lines.push(`  ⚠️ No numbers currently available for this combination.`)
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}
