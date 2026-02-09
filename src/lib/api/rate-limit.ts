import { NextResponse } from 'next/server'

/**
 * Simple in-memory rate limiter for API routes.
 * 
 * Tracks requests per user within a sliding window.
 * Suitable for single-instance Vercel serverless (per-isolate limiting).
 * For multi-instance production, replace with Redis-based limiting.
 * 
 * Usage:
 * ```ts
 * const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 })
 * 
 * export async function POST(request) {
 *   const userId = ... // get from auth
 *   const limited = limiter.check(userId)
 *   if (limited) return limited
 *   // ... handle request
 * }
 * ```
 */

interface RateLimitConfig {
  /** Maximum number of requests allowed within the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, RateLimitEntry>>()

export function createRateLimiter(config: RateLimitConfig) {
  const storeKey = `${config.maxRequests}-${config.windowMs}`
  if (!stores.has(storeKey)) {
    stores.set(storeKey, new Map())
  }
  const store = stores.get(storeKey)!

  // Periodic cleanup of expired entries (every 60s)
  const CLEANUP_INTERVAL = 60_000
  let lastCleanup = Date.now()

  function cleanup() {
    const now = Date.now()
    if (now - lastCleanup < CLEANUP_INTERVAL) return
    lastCleanup = now
    store.forEach((entry, key) => {
      if (entry.resetAt < now) {
        store.delete(key)
      }
    })
  }

  return {
    /**
     * Check if a request should be rate limited.
     * Returns null if allowed, or a NextResponse if limited.
     */
    check(userId: string): NextResponse | null {
      cleanup()
      const now = Date.now()
      const entry = store.get(userId)

      if (!entry || entry.resetAt < now) {
        // First request or window expired
        store.set(userId, { count: 1, resetAt: now + config.windowMs })
        return null
      }

      entry.count++

      if (entry.count > config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
        return NextResponse.json(
          {
            error: 'Too many requests',
            retryAfter,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(config.maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
            },
          }
        )
      }

      return null
    },
  }
}

// Pre-configured limiters for expensive endpoints
/** Generation: 20 requests per minute per user */
export const generateLimiter = createRateLimiter({ maxRequests: 20, windowMs: 60_000 })

/** AI analysis: 10 requests per minute per user */
export const analyzeLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 })

/** AI assistant chat: 30 requests per minute per user */
export const assistantChatLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })

/** Prompt enhancement: 20 requests per minute per user */
export const enhanceLimiter = createRateLimiter({ maxRequests: 20, windowMs: 60_000 })
