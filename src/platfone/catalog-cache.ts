import { PlatfoneClient } from './client.ts'
import { Country, Service } from './types.ts'

/**
 * Lazy-loads and caches countries + services for the session lifetime
 */
export class CatalogCache {
  private countries: Country[] | null = null
  private services: Service[] | null = null

  constructor(private readonly client: PlatfoneClient) {}

  async warmUp(): Promise<void> {
    await Promise.all([this.getCountries(), this.getServices()])
  }

  async getCountries(): Promise<Country[]> {
    if (!this.countries) {
      this.countries = await this.client.getCountries()
    }
    return this.countries
  }

  async getServices(): Promise<Service[]> {
    if (!this.services) {
      this.services = await this.client.getServices()
    }
    return this.services
  }

  async resolveCountryId(query: string): Promise<{ country_id: string; name: string } | null> {
    const countries = await this.getCountries()
    const q = query.toLowerCase().trim()

    const byId = countries.find((c) => c.country_id.toLowerCase() === q)
    if (byId) return { country_id: byId.country_id, name: byId.name }

    const byName = countries.find((c) => c.name.toLowerCase() === q)
    if (byName) return { country_id: byName.country_id, name: byName.name }

    const byPrefix = countries.find((c) => c.name.toLowerCase().startsWith(q))
    if (byPrefix) return { country_id: byPrefix.country_id, name: byPrefix.name }

    const byIncludes = countries.find((c) => c.name.toLowerCase().includes(q) || c.alt_name.toLowerCase().includes(q))
    if (byIncludes) return { country_id: byIncludes.country_id, name: byIncludes.name }

    return null
  }

  async resolveServiceId(query: string): Promise<{ service_id: string; name: string } | null> {
    const services = (await this.getServices()).filter((s) => !s.prohibited)
    const q = query.toLowerCase().trim()

    const byId = services.find((s) => s.service_id.toLowerCase() === q)
    if (byId) return { service_id: byId.service_id, name: byId.name }

    const byName = services.find((s) => s.name.toLowerCase() === q)
    if (byName) return { service_id: byName.service_id, name: byName.name }

    const byPrefix = services.find((s) => s.name.toLowerCase().startsWith(q))
    if (byPrefix) return { service_id: byPrefix.service_id, name: byPrefix.name }

    const byIncludes = services.find((s) => s.name.toLowerCase().includes(q) || s.alt_name.toLowerCase().includes(q))
    if (byIncludes) return { service_id: byIncludes.service_id, name: byIncludes.name }

    return null
  }
}
