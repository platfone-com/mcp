import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

export type CredentialSource = 'header' | 'server'

export interface Principal {
  apiKey: string
  source: CredentialSource
  fingerprint: Buffer
}

// Per-process secret so fingerprints cannot be correlated with keys outside this process.
const FINGERPRINT_SECRET = randomBytes(32)

function fingerprint(source: CredentialSource, apiKey: string): Buffer {
  return createHmac('sha256', FINGERPRINT_SECRET).update(source).update('\0').update(apiKey).digest()
}

/**
 * Resolves the caller principal from the `x-api-key` header, falling back to the
 * server key. The credential source is part of the identity, so a session opened
 * with one source can never be operated with the other.
 */
export function resolvePrincipal(headers: IncomingHttpHeaders, serverApiKey?: string): Principal | null {
  const raw = headers['x-api-key']
  const headerKey = Array.isArray(raw) ? raw[0] : raw

  if (headerKey) return { apiKey: headerKey, source: 'header', fingerprint: fingerprint('header', headerKey) }
  if (serverApiKey) return { apiKey: serverApiKey, source: 'server', fingerprint: fingerprint('server', serverApiKey) }
  return null
}

export function isSamePrincipal(owner: Buffer, caller: Principal): boolean {
  return timingSafeEqual(owner, caller.fingerprint)
}
