import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PlatfoneClient } from '../platfone/client.ts'
import { CatalogCache } from '../platfone/catalog-cache.ts'
import {
  registerListCountries,
  registerListServices,
  registerOrderNumber,
  registerCheckSms,
  registerCancelActivation,
  registerRetryActivation
} from '../tools/index.ts'

export function createMcpServer(client: PlatfoneClient): { server: McpServer; catalog: CatalogCache } {
  const server = new McpServer({
    name: 'platfone-mcp',
    title: 'Platfone SMS Activation',
    version: '1.0.0',
    description:
      'Rent virtual phone numbers and receive SMS verification codes via the Platfone API. Supports ordering numbers by country and service, polling for incoming SMS, retrying, and canceling activations.',
    websiteUrl: 'https://platfone.com'
  })

  const catalog = new CatalogCache(client)

  registerListCountries(server, catalog)
  registerListServices(server, catalog)
  registerOrderNumber(server, client, catalog)
  registerCheckSms(server, client)
  registerCancelActivation(server, client)
  registerRetryActivation(server, client)

  return { server, catalog }
}
