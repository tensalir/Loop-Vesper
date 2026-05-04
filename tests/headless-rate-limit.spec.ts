import { test, expect } from '@playwright/test'
import { rateLimitHeaders } from '../src/lib/headless/rate-limit'

/**
 * Pure unit tests for rate-limit header construction. The actual bucket
 * increment hits the database and is exercised in integration tests.
 */

test.describe('rateLimitHeaders', () => {
  test('emits all four standard limit/remaining/reset headers', () => {
    const headers = rateLimitHeaders({
      minute: { allowed: true, count: 1, limit: 60, resetSeconds: 30 },
      day: { allowed: true, count: 10, limit: 5000, resetSeconds: 7200 },
    })
    expect(headers['X-RateLimit-Limit-Minute']).toBe('60')
    expect(headers['X-RateLimit-Remaining-Minute']).toBe('59')
    expect(headers['X-RateLimit-Reset-Minute']).toBe('30')
    expect(headers['X-RateLimit-Limit-Day']).toBe('5000')
    expect(headers['X-RateLimit-Remaining-Day']).toBe('4990')
    expect(headers['X-RateLimit-Reset-Day']).toBe('7200')
    expect(headers['Retry-After']).toBeUndefined()
  })

  test('clamps remaining to 0 when count exceeds limit', () => {
    const headers = rateLimitHeaders({
      minute: { allowed: false, count: 100, limit: 60, resetSeconds: 30 },
      day: { allowed: true, count: 10, limit: 5000, resetSeconds: 7200 },
    })
    expect(headers['X-RateLimit-Remaining-Minute']).toBe('0')
    expect(headers['Retry-After']).toBe('30')
  })

  test('Retry-After uses minute reset when minute is exhausted', () => {
    const headers = rateLimitHeaders({
      minute: { allowed: false, count: 100, limit: 60, resetSeconds: 12 },
      day: { allowed: true, count: 10, limit: 5000, resetSeconds: 7200 },
    })
    expect(headers['Retry-After']).toBe('12')
  })

  test('Retry-After uses day reset when only day is exhausted', () => {
    const headers = rateLimitHeaders({
      minute: { allowed: true, count: 1, limit: 60, resetSeconds: 30 },
      day: { allowed: false, count: 6000, limit: 5000, resetSeconds: 5400 },
    })
    expect(headers['Retry-After']).toBe('5400')
  })
})
