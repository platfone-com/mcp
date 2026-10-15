import { isIPv6 } from 'node:net'

export interface RateLimitDecision {
  allowed: boolean
  retryAfterMs: number
}

/** Fixed-window counter per key with a bounded number of tracked keys. */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
    private readonly now: () => number = Date.now
  ) {}

  take(key: string): RateLimitDecision {
    const at = this.now()
    let window = this.windows.get(key)

    if (!window || window.resetAt <= at) {
      this.windows.delete(key)
      if (this.windows.size >= this.maxKeys) this.prune()
      while (this.windows.size >= this.maxKeys) {
        const oldest = this.windows.keys().next().value
        if (oldest === undefined) break
        this.windows.delete(oldest)
      }
      window = { count: 0, resetAt: at + this.windowMs }
      this.windows.set(key, window)
    }

    if (window.count >= this.limit) return { allowed: false, retryAfterMs: window.resetAt - at }
    window.count++
    return { allowed: true, retryAfterMs: 0 }
  }

  prune() {
    const at = this.now()
    for (const [key, window] of this.windows) {
      if (window.resetAt <= at) this.windows.delete(key)
    }
  }
}

/**
 * Picks the client address from a proxy header. For list headers such as `X-Forwarded-For`
 * the rightmost entry is used, because it is the one appended by the nearest trusted proxy.
 */
export function addressFromHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[value.length - 1] : value
  const entry = raw?.split(',').pop()?.trim()
  return entry || undefined
}

/** Groups IPv6 clients by /64, since a single host typically controls a whole /64. */
export function rateLimitKey(address: string): string {
  const addr = address.replace(/%.*$/, '')
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr)
  if (mapped) return mapped[1]
  if (!isIPv6(addr)) return addr

  const [head, tail] = addr.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const zeros = tail === undefined ? [] : Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0')
  const prefix = [...headGroups, ...zeros, ...tailGroups].slice(0, 4).map((g) => parseInt(g, 16).toString(16))
  return `${prefix.join(':')}::/64`
}
