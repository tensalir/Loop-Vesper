/**
 * Durable rate limiter for the headless Vesper surface.
 *
 * Why DB-backed: the in-memory limiter in `lib/api/rate-limit.ts` is fine
 * for browser routes because each isolate handles a single user session
 * for a short time. External MCP/REST callers can hit any isolate and
 * burst with one fresh worker per request, so we keep counters in
 * Postgres via `HeadlessRateBucket`. Atomic upserts prevent two parallel
 * requests from both winning a near-cap counter.
 */

import { prisma } from '@/lib/prisma'

export type RateLimitWindow = 'minute' | 'day'

export interface RateLimitDecision {
  allowed: boolean
  /** How many requests have been made in the current window after this check. */
  count: number
  /** Total requests allowed in the window. */
  limit: number
  /** Seconds until the window resets. */
  resetSeconds: number
}

const DEFAULTS = {
  perMinute: 60,
  perDay: 5_000,
}

function bucketLabel(window: RateLimitWindow, now: Date = new Date()): string {
  if (window === 'minute') {
    // ISO minute precision e.g. '2026-05-04T11:48Z'
    const iso = now.toISOString()
    return `${iso.slice(0, 16)}Z`
  }
  // ISO date e.g. '2026-05-04'
  return now.toISOString().slice(0, 10)
}

function resetSecondsFor(window: RateLimitWindow, now: Date = new Date()): number {
  if (window === 'minute') {
    const next = new Date(now)
    next.setUTCSeconds(0, 0)
    next.setUTCMinutes(now.getUTCMinutes() + 1)
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000))
  }
  const next = new Date(now)
  next.setUTCHours(0, 0, 0, 0)
  next.setUTCDate(now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000))
}

async function incrementBucket(
  credentialId: string,
  window: RateLimitWindow
): Promise<number> {
  const bucket = bucketLabel(window)
  const updated = await prisma.headlessRateBucket.upsert({
    where: {
      credentialId_window_bucket: {
        credentialId,
        window,
        bucket,
      },
    },
    create: {
      credentialId,
      window,
      bucket,
      count: 1,
    },
    update: {
      count: { increment: 1 },
    },
    select: { count: true },
  })
  return updated.count
}

export interface CredentialLimits {
  rateLimitPerMinute?: number | null
  rateLimitPerDay?: number | null
}

/**
 * Atomically increment the minute and day buckets for a credential and
 * return whether the request is within the policy limits. Caller should
 * treat `allowed === false` as a hard 429.
 */
export async function checkAndIncrementHeadlessRate(
  credentialId: string,
  limits: CredentialLimits
): Promise<{ minute: RateLimitDecision; day: RateLimitDecision; allowed: boolean }> {
  const minuteLimit = limits.rateLimitPerMinute ?? DEFAULTS.perMinute
  const dayLimit = limits.rateLimitPerDay ?? DEFAULTS.perDay

  // Increment in parallel to keep p99 latency low. If only one increment
  // succeeds and the policy rejects, the unused increment is harmless —
  // the next-window cleanup will clear it.
  const [minuteCount, dayCount] = await Promise.all([
    incrementBucket(credentialId, 'minute'),
    incrementBucket(credentialId, 'day'),
  ])

  const now = new Date()
  const minute: RateLimitDecision = {
    allowed: minuteCount <= minuteLimit,
    count: minuteCount,
    limit: minuteLimit,
    resetSeconds: resetSecondsFor('minute', now),
  }
  const day: RateLimitDecision = {
    allowed: dayCount <= dayLimit,
    count: dayCount,
    limit: dayLimit,
    resetSeconds: resetSecondsFor('day', now),
  }

  return { minute, day, allowed: minute.allowed && day.allowed }
}

/**
 * Build standard `X-RateLimit-*` headers for a successful or limited
 * response. `Retry-After` is only meaningful when at least one window
 * is exhausted.
 */
export function rateLimitHeaders(
  decision: { minute: RateLimitDecision; day: RateLimitDecision }
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit-Minute': String(decision.minute.limit),
    'X-RateLimit-Remaining-Minute': String(Math.max(0, decision.minute.limit - decision.minute.count)),
    'X-RateLimit-Reset-Minute': String(decision.minute.resetSeconds),
    'X-RateLimit-Limit-Day': String(decision.day.limit),
    'X-RateLimit-Remaining-Day': String(Math.max(0, decision.day.limit - decision.day.count)),
    'X-RateLimit-Reset-Day': String(decision.day.resetSeconds),
  }
  if (!decision.minute.allowed || !decision.day.allowed) {
    const retryAfter = decision.minute.allowed ? decision.day.resetSeconds : decision.minute.resetSeconds
    headers['Retry-After'] = String(retryAfter)
  }
  return headers
}
