/**
 * API usage tracking with atomic counters
 * 
 * Uses Prisma upsert + increment for multi-user safe counting.
 * Tracks usage per provider/scope at minute and month granularity.
 * 
 * NOTE: This module is server-only. Client components should use the API endpoint.
 */

import {
  RateLimitProvider,
  RateLimitScope,
  RateLimitWindow,
  getCurrentMinuteBucket,
  getCurrentMonthBucket,
  getRateLimits,
  getSecondsUntilMinuteReset,
  getSecondsUntilMonthReset,
  isLimitExceeded,
  isNearLimit,
} from './config'

// Lazy-load prisma to avoid client-side bundle issues
// Prisma is server-only and will throw if DATABASE_URL is not set
const getPrisma = () => {
  if (typeof window !== 'undefined') {
    // We're on the client - return null
    return null
  }
  // Dynamic import to avoid bundling prisma in client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('@/lib/prisma')
  return prisma
}

export type RateLimitStatus = 'ok' | 'limited' | 'blocked'

export interface UsageSnapshot {
  provider: RateLimitProvider
  scope: RateLimitScope
  minute: {
    used: number
    limit: number
    remaining: number
    resetInSeconds: number
  }
  month: {
    used: number
    limit: number
    remaining: number
    resetInSeconds: number
  }
  status: RateLimitStatus
  fallbackActive: boolean
}

export interface ProviderSnapshot {
  gemini: {
    nanoBanana: UsageSnapshot
    veo: UsageSnapshot
    overall: RateLimitStatus
  }
  replicate: {
    kling: UsageSnapshot
    nanoBanana: UsageSnapshot
    overall: RateLimitStatus
  }
}

/**
 * Check if we're on the server and ApiUsageCounter model is available
 * This handles client-side calls and the case where Prisma client hasn't been regenerated
 */
function isApiUsageCounterAvailable(): boolean {
  if (typeof window !== 'undefined') {
    // Client-side - not available
    return false
  }
  const prisma = getPrisma()
  return prisma && typeof prisma.apiUsageCounter?.findUnique === 'function'
}

/**
 * Get usage count for a specific bucket
 */
async function getUsageCount(
  provider: RateLimitProvider,
  scope: RateLimitScope,
  window: RateLimitWindow,
  bucket: string
): Promise<number> {
  // Handle case where we're on client or Prisma client hasn't been regenerated
  if (!isApiUsageCounterAvailable()) {
    return 0
  }
  
  try {
    const prisma = getPrisma()
    const record = await prisma.apiUsageCounter.findUnique({
      where: {
        provider_scope_window_bucket: {
          provider,
          scope,
          window,
          bucket,
        },
      },
    })
    return record?.count ?? 0
  } catch (error) {
    console.warn('[RateLimits] Failed to get usage count:', error)
    return 0
  }
}

/**
 * Increment usage counter atomically
 * Uses upsert to create if not exists, then increment
 */
export async function incrementUsage(
  provider: RateLimitProvider,
  scope: RateLimitScope,
  window: RateLimitWindow,
  bucket: string,
  amount: number = 1
): Promise<number> {
  // Handle case where we're on client or Prisma client hasn't been regenerated
  if (!isApiUsageCounterAvailable()) {
    return 0
  }
  
  try {
    const prisma = getPrisma()
    const result = await prisma.apiUsageCounter.upsert({
      where: {
        provider_scope_window_bucket: {
          provider,
          scope,
          window,
          bucket,
        },
      },
      create: {
        provider,
        scope,
        window,
        bucket,
        count: amount,
      },
      update: {
        count: {
          increment: amount,
        },
      },
    })
    return result.count
  } catch (error) {
    console.warn('[RateLimits] Failed to increment usage:', error)
    return 0
  }
}

/**
 * Record an API call for both minute and month windows
 */
export async function recordApiCall(
  provider: RateLimitProvider,
  scope: RateLimitScope,
  amount: number = 1
): Promise<void> {
  const minuteBucket = getCurrentMinuteBucket()
  const monthBucket = getCurrentMonthBucket()

  await Promise.all([
    incrementUsage(provider, scope, 'minute', minuteBucket, amount),
    incrementUsage(provider, scope, 'month', monthBucket, amount),
  ])
}

/**
 * Get usage snapshot for a specific provider/scope
 */
export async function getUsageSnapshot(
  provider: RateLimitProvider,
  scope: RateLimitScope
): Promise<UsageSnapshot> {
  const limits = getRateLimits(provider, scope)
  const minuteBucket = getCurrentMinuteBucket()
  const monthBucket = getCurrentMonthBucket()

  const [minuteUsed, monthUsed] = await Promise.all([
    getUsageCount(provider, scope, 'minute', minuteBucket),
    getUsageCount(provider, scope, 'month', monthBucket),
  ])

  const minuteRemaining = Math.max(0, limits.rpm - minuteUsed)
  const monthRemaining = Math.max(0, limits.monthly - monthUsed)

  // Determine status based on limits
  let status: RateLimitStatus = 'ok'
  if (isLimitExceeded(minuteUsed, limits.rpm) || isLimitExceeded(monthUsed, limits.monthly)) {
    status = 'blocked'
  } else if (isNearLimit(minuteUsed, limits.rpm) || isNearLimit(monthUsed, limits.monthly)) {
    status = 'limited'
  }

  // Check if fallback routing is active for this scope
  // (This is determined by the provider router, but we can infer from recent usage patterns)
  const fallbackActive = false // Will be set by routing logic

  return {
    provider,
    scope,
    minute: {
      used: minuteUsed,
      limit: limits.rpm,
      remaining: minuteRemaining,
      resetInSeconds: getSecondsUntilMinuteReset(),
    },
    month: {
      used: monthUsed,
      limit: limits.monthly,
      remaining: monthRemaining,
      resetInSeconds: getSecondsUntilMonthReset(),
    },
    status,
    fallbackActive,
  }
}

/**
 * Get full provider snapshot for the rate limits API
 */
export async function getProviderSnapshot(): Promise<ProviderSnapshot> {
  const [
    geminiNanoBanana,
    geminiVeo,
    replicateKling,
    replicateNanoBanana,
  ] = await Promise.all([
    getUsageSnapshot('gemini', 'gemini-nano-banana-pro'),
    getUsageSnapshot('gemini', 'gemini-veo-3.1'),
    getUsageSnapshot('replicate', 'replicate-kling-2.6'),
    getUsageSnapshot('replicate', 'replicate-nano-banana'),
  ])

  // Derive overall status for each provider
  const geminiOverall: RateLimitStatus = 
    geminiNanoBanana.status === 'blocked' || geminiVeo.status === 'blocked' ? 'blocked' :
    geminiNanoBanana.status === 'limited' || geminiVeo.status === 'limited' ? 'limited' : 'ok'

  const replicateOverall: RateLimitStatus =
    replicateKling.status === 'blocked' || replicateNanoBanana.status === 'blocked' ? 'blocked' :
    replicateKling.status === 'limited' || replicateNanoBanana.status === 'limited' ? 'limited' : 'ok'

  return {
    gemini: {
      nanoBanana: geminiNanoBanana,
      veo: geminiVeo,
      overall: geminiOverall,
    },
    replicate: {
      kling: replicateKling,
      nanoBanana: replicateNanoBanana,
      overall: replicateOverall,
    },
  }
}

/**
 * Check if a provider/scope can accept another request
 */
export async function canAcceptRequest(
  provider: RateLimitProvider,
  scope: RateLimitScope
): Promise<{ allowed: boolean; status: RateLimitStatus; reason?: string }> {
  const snapshot = await getUsageSnapshot(provider, scope)
  
  if (snapshot.status === 'blocked') {
    const blockedBy = snapshot.minute.remaining === 0 ? 'minute' : 'month'
    const resetIn = blockedBy === 'minute' 
      ? snapshot.minute.resetInSeconds 
      : snapshot.month.resetInSeconds
    
    return {
      allowed: false,
      status: 'blocked',
      reason: `Rate limit exceeded (${blockedBy}). Reset in ${Math.ceil(resetIn)}s`,
    }
  }

  return {
    allowed: true,
    status: snapshot.status,
  }
}

/**
 * Clean up old counter records (optional maintenance)
 * Deletes minute buckets older than 1 hour and month buckets older than 3 months
 */
export async function cleanupOldCounters(): Promise<number> {
  // Handle case where we're on client or Prisma client hasn't been regenerated
  if (!isApiUsageCounterAvailable()) {
    return 0
  }
  
  try {
    const prisma = getPrisma()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    // Delete old minute buckets
    const minuteResult = await prisma.apiUsageCounter.deleteMany({
      where: {
        window: 'minute',
        createdAt: {
          lt: oneHourAgo,
        },
      },
    })

    // Delete old month buckets
    const monthResult = await prisma.apiUsageCounter.deleteMany({
      where: {
        window: 'month',
        createdAt: {
          lt: threeMonthsAgo,
        },
      },
    })

    return minuteResult.count + monthResult.count
  } catch (error) {
    console.warn('[RateLimits] Failed to cleanup counters:', error)
    return 0
  }
}
