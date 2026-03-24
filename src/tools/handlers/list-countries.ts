import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CatalogCache } from '../../platfone/catalog-cache.ts'
import { formatError } from '../helpers.ts'

export function registerListCountries(server: McpServer, catalog: CatalogCache) {
  server.registerTool(
    'list_countries',
    {
      title: 'Countries List',
      description:
        'Returns the Platfone catalog of available countries with their IDs. Use country_id when calling order_number. IDs ending with "_v" indicate virtual numbers only.',
      inputSchema: {},
      annotations: {
        title: 'Countries List',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const countries = await catalog.getCountries()
        const text = countries.map((c) => `${c.country_id} — ${c.name}`).join('\n')

        return {
          content: [{ type: 'text', text: text || 'No countries available.' }]
        }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}

