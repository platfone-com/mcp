import { normalizeBaseUrl } from '../platfone/client.ts'
import type { Principal } from './session-auth.ts'

export type CredentialStatus = 'valid' | 'invalid' | 'unavailable' | 'busy'
export type CredentialCheckSource = 'upstream' | 'cache' | 'coalesced' | 'limiter'

export interface CredentialCheckResult {
  status: CredentialStatus
  source: CredentialCheckSource
}

export interface CredentialVerifierOptions {
  baseUrl?: string
  timeoutMs?: number
  maxConcurrent?: number
  validTtlMs?: number
  invalidTtlMs?: number
  maxCacheEntries?: number
  now?: () => number
}

export const CREDENTIAL_CHECK_TIMEOUT_MS = 5_000
export const MAX_CONCURRENT_CREDENTIAL_CHECKS = 16
const VALID_TTL_MS = 60_000
const INVALID_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 10_000

/**
 * Verifies API keys against the Platfone API before a session is admitted.
 * Upstream checks are timeout-bound, concurrency-bound (excess callers fail fast with `busy`)
 * and coalesced per key. Only definitive answers are cached, keyed by the principal fingerprint,
 * so plaintext keys are never stored here.
 */
export class CredentialVerifier {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxConcurrent: number
  private readonly validTtlMs: number
  private readonly invalidTtlMs: number
  private readonly maxCacheEntries: number
  private readonly now: () => number
  private readonly cache = new Map<string, { status: 'valid' | 'invalid'; expiresAt: number }>()
  private readonly inFlight = new Map<string, Promise<CredentialStatus>>()

  constructor(opts: CredentialVerifierOptions = {}) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.timeoutMs = opts.timeoutMs ?? CREDENTIAL_CHECK_TIMEOUT_MS
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_CREDENTIAL_CHECKS
    this.validTtlMs = opts.validTtlMs ?? VALID_TTL_MS
    this.invalidTtlMs = opts.invalidTtlMs ?? INVALID_TTL_MS
    this.maxCacheEntries = opts.maxCacheEntries ?? MAX_CACHE_ENTRIES
    this.now = opts.now ?? Date.now
  }

  async verify(principal: Principal): Promise<CredentialCheckResult> {
    const id = principal.fingerprint.toString('hex')

    const cached = this.cache.get(id)
    if (cached && cached.expiresAt > this.now()) return { status: cached.status, source: 'cache' }
    if (cached) this.cache.delete(id)

    const pending = this.inFlight.get(id)
    if (pending) return { status: await pending, source: 'coalesced' }

    if (this.inFlight.size >= this.maxConcurrent) return { status: 'busy', source: 'limiter' }

    const check = this.check(principal.apiKey)
      .then((status) => {
        if (status === 'valid' || status === 'invalid') this.remember(id, status)
        return status
      })
      .finally(() => this.inFlight.delete(id))
    this.inFlight.set(id, check)

    return { status: await check, source: 'upstream' }
  }

  invalidate(principal: Principal) {
    this.cache.delete(principal.fingerprint.toString('hex'))
  }

  private remember(id: string, status: 'valid' | 'invalid') {
    this.cache.delete(id)
    while (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    const ttl = status === 'valid' ? this.validTtlMs : this.invalidTtlMs
    this.cache.set(id, { status, expiresAt: this.now() + ttl })
  }

  private async check(apiKey: string): Promise<CredentialStatus> {
    try {
      const res = await fetch(`${this.baseUrl}/user/balance`, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      await res.body?.cancel()

      if (res.ok) return 'valid'
      // The Platfone API reports every rejected key as 401; anything else (incl. an edge 403) is not a verdict.
      if (res.status === 401) return 'invalid'

      console.error(`API key check failed: upstream responded with HTTP ${res.status}`)
      return 'unavailable'
    } catch (err) {
      console.error(`API key check failed: ${err instanceof Error ? err.name : 'unknown error'}`)
      return 'unavailable'
    }
  }
}
