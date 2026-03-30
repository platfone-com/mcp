import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CatalogCache } from '../../platfone/catalog-cache.ts'
import { formatError } from '../helpers.ts'

export function registerListServices(server: McpServer, catalog: CatalogCache) {
  server.registerTool(
    'list_services',
    {
      title: 'Services List',
      description:
        'Returns the Platfone catalog of available service categories with their IDs. Use service_id when calling order_number. The "other" service covers categories not explicitly listed.',
      inputSchema: {},
      annotations: {
        title: 'Services List',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const services = (await catalog.getServices()).filter((s) => !s.prohibited)
        const text = services.map((s) => `${s.service_id} — ${s.name}`).join('\n')

        return {
          content: [{ type: 'text', text: text || 'No services available.' }]
        }
      } catch (err) {
        return formatError(err)
      }
    }
  )
}
