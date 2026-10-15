import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FixedWindowRateLimiter, addressFromHeader, rateLimitKey } from '../src/server/rate-limiter.ts'

describe('rate limiter helpers', () => {
  it('normalizes client addresses into rate-limit keys', () => {
    assert.equal(rateLimitKey('203.0.113.7'), '203.0.113.7')
    assert.equal(rateLimitKey('::ffff:203.0.113.7'), '203.0.113.7')
    assert.equal(rateLimitKey('2001:db8:1:2::1'), '2001:db8:1:2::/64')
    assert.equal(rateLimitKey('2001:0db8:0001:0002:ffff:0:0:1'), '2001:db8:1:2::/64')
    assert.equal(rateLimitKey('2001:db8::1'), '2001:db8:0:0::/64')
    assert.equal(rateLimitKey('fe80::1%eth0'), 'fe80:0:0:0::/64')
    assert.equal(rateLimitKey('::1'), '0:0:0:0::/64')
  })

  it('takes the rightmost entry of a proxy header', () => {
    assert.equal(addressFromHeader('198.51.100.1, 203.0.113.9'), '203.0.113.9')
    assert.equal(addressFromHeader('203.0.113.9'), '203.0.113.9')
    assert.equal(addressFromHeader(['1.1.1.1', '2.2.2.2']), '2.2.2.2')
    assert.equal(addressFromHeader(''), undefined)
    assert.equal(addressFromHeader(undefined), undefined)
  })

  it('bounds the number of tracked keys', () => {
    let now = 0
    const limiter = new FixedWindowRateLimiter(1, 1_000, 2, () => now)
    assert.equal(limiter.take('a').allowed, true)
    assert.equal(limiter.take('a').allowed, false)
    limiter.take('b')
    limiter.take('c')
    assert.equal(limiter.take('a').allowed, true)
    now = 1_000
    assert.equal(limiter.take('c').allowed, true)
  })
})
