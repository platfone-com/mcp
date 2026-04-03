import { PlatfoneClient } from './client.ts'
import { Country, Service } from './types.ts'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type ResolveResult<T extends string> =
  | { [K in T]: string } & { name: string }
  | { ambiguous: string[] }
  | null

/**
 * In-memory catalog cache with ETag-based conditional refresh every 5 minutes.
 * Countries and services are never exposed to the agent directly —
 * only searched/resolved server-side to keep context windows small.
 */
export class CatalogCache {
  private countries: Country[] | null = null
  private services: Service[] | null = null
  private countriesEtag: string | null = null
  private servicesEtag: string | null = null
  private countriesRefreshedAt = 0
  private servicesRefreshedAt = 0

  constructor(private readonly client: PlatfoneClient) {}

  async warmUp(): Promise<void> {
    await Promise.all([this.getCountries(), this.getServices()])
  }

  async getCountries(): Promise<Country[]> {
    const now = Date.now()
    if (this.countries && now - this.countriesRefreshedAt < REFRESH_INTERVAL_MS) {
      return this.countries
    }

    const result = await this.client.getCountries(this.countriesEtag ?? undefined)
    this.countriesRefreshedAt = now

    if (result === null) {
      return this.countries!
    }

    this.countries = result.data
    this.countriesEtag = result.etag
    return this.countries
  }

  async getServices(): Promise<Service[]> {
    const now = Date.now()
    if (this.services && now - this.servicesRefreshedAt < REFRESH_INTERVAL_MS) {
      return this.services
    }

    const result = await this.client.getServices(this.servicesEtag ?? undefined)
    this.servicesRefreshedAt = now

    if (result === null) {
      return this.services!
    }

    this.services = result.data
    this.servicesEtag = result.etag
    return this.services
  }

  async resolveCountryId(query: string): Promise<ResolveResult<'country_id'>> {
    const countries = await this.getCountries()
    const q = query.toLowerCase().trim()

    const byId = countries.find((c) => c.country_id.toLowerCase() === q)
    if (byId) return { country_id: byId.country_id, name: byId.name }

    const byName = countries.find((c) => c.name.toLowerCase() === q)
    if (byName) return { country_id: byName.country_id, name: byName.name }

    if (q.length >= 3) {
      const prefixMatches = countries.filter((c) => c.name.toLowerCase().startsWith(q))
      if (prefixMatches.length === 1) return { country_id: prefixMatches[0].country_id, name: prefixMatches[0].name }
      if (prefixMatches.length > 1) return { ambiguous: prefixMatches.map((c) => c.name) }

      const re = new RegExp(`\\b${escapeRegex(q)}`, 'i')
      const substringMatches = countries.filter((c) => re.test(c.name) || re.test(c.alt_name))
      if (substringMatches.length === 1)
        return { country_id: substringMatches[0].country_id, name: substringMatches[0].name }
      if (substringMatches.length > 1) return { ambiguous: substringMatches.map((c) => c.name) }
    }

    return null
  }

  async resolveServiceId(query: string): Promise<ResolveResult<'service_id'>> {
    const services = (await this.getServices()).filter((s) => !s.prohibited)
    const q = query.toLowerCase().trim()

    const byId = services.find((s) => s.service_id.toLowerCase() === q)
    if (byId) return { service_id: byId.service_id, name: byId.name }

    const byName = services.find((s) => s.name.toLowerCase() === q)
    if (byName) return { service_id: byName.service_id, name: byName.name }

    if (q.length >= 3) {
      const prefixMatches = services.filter((s) => s.name.toLowerCase().startsWith(q))
      if (prefixMatches.length === 1) return { service_id: prefixMatches[0].service_id, name: prefixMatches[0].name }
      if (prefixMatches.length > 1) return { ambiguous: prefixMatches.map((s) => s.name) }

      const re = new RegExp(`\\b${escapeRegex(q)}`, 'i')
      const substringMatches = services.filter((s) => re.test(s.name) || re.test(s.alt_name))
      if (substringMatches.length === 1)
        return { service_id: substringMatches[0].service_id, name: substringMatches[0].name }
      if (substringMatches.length > 1) return { ambiguous: substringMatches.map((s) => s.name) }
    }

    return null
  }
}
