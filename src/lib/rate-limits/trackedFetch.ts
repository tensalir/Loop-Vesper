/**
 * Tracked fetch wrapper for rate limit monitoring
 * 
 * Wraps fetch() calls to:
 * 1. Count API calls per provider/scope
 * 2. Detect 429 rate limit responses and capture Retry-After
 * 3. Track temporary blocks from rate limit errors
 */

import { recordApiCall } from './usage'
import { RateLimitProvider, RateLimitScope, getProviderForModel, getScopeForModel } from './config'

export interface TrackedFetchOptions extends RequestInit {
  /** The provider making the request (e.g., 'gemini', 'replicate') */
  provider?: RateLimitProvider
  /** The scope/model for tracking (e.g., 'gemini-nano-banana-pro') */
  scope?: RateLimitScope
  /** The model ID (alternative to provider/scope, will be mapped automatically) */
  modelId?: string
  /** Skip counting this request (for non-generation API calls) */
  skipTracking?: boolean
}

export interface TrackedFetchResult {
  response: Response
  wasRateLimited: boolean
  retryAfterSeconds?: number
}

// In-memory cache of recent 429 errors per provider/scope
// Used to temporarily block requests after receiving a 429
const recentRateLimits: Map<string, { timestamp: number; retryAfter: number }> = new Map()

/**
 * Check if a provider/scope is temporarily blocked due to recent 429
 */
export function isTemporarilyBlocked(provider: RateLimitProvider, scope: RateLimitScope): boolean {
  const key = `${provider}:${scope}`
  const block = recentRateLimits.get(key)
  
  if (!block) return false
  
  const elapsed = Date.now() - block.timestamp
  const blockDurationMs = block.retryAfter * 1000
  
  if (elapsed >= blockDurationMs) {
    // Block has expired, remove it
    recentRateLimits.delete(key)
    return false
  }
  
  return true
}

/**
 * Get remaining block time in seconds
 */
export function getRemainingBlockTime(provider: RateLimitProvider, scope: RateLimitScope): number {
  const key = `${provider}:${scope}`
  const block = recentRateLimits.get(key)
  
  if (!block) return 0
  
  const elapsed = Date.now() - block.timestamp
  const blockDurationMs = block.retryAfter * 1000
  const remaining = Math.max(0, blockDurationMs - elapsed)
  
  return Math.ceil(remaining / 1000)
}

/**
 * Record a 429 rate limit error
 */
function recordRateLimitError(provider: RateLimitProvider, scope: RateLimitScope, retryAfter: number): void {
  const key = `${provider}:${scope}`
  recentRateLimits.set(key, {
    timestamp: Date.now(),
    retryAfter,
  })
  
  console.warn(`[RateLimit] ${provider}/${scope} hit 429, blocking for ${retryAfter}s`)
}

/**
 * Parse Retry-After header value
 * Can be a number of seconds or an HTTP date
 */
function parseRetryAfter(retryAfter: string | null): number {
  if (!retryAfter) return 60 // Default to 60 seconds
  
  // Try parsing as number of seconds
  const seconds = parseInt(retryAfter, 10)
  if (!isNaN(seconds)) return seconds
  
  // Try parsing as HTTP date
  const date = new Date(retryAfter)
  if (!isNaN(date.getTime())) {
    const diff = date.getTime() - Date.now()
    return Math.max(1, Math.ceil(diff / 1000))
  }
  
  return 60 // Default fallback
}

/**
 * Detect rate limit from response
 */
function isRateLimitResponse(response: Response): boolean {
  return response.status === 429
}

/**
 * Detect rate limit from Google-specific error codes
 */
function isGoogleRateLimitError(responseBody: any): boolean {
  const errorCode = responseBody?.error?.code
  const errorStatus = responseBody?.error?.status
  
  return (
    errorCode === 429 ||
    errorCode === 'RESOURCE_EXHAUSTED' ||
    errorStatus === 'RESOURCE_EXHAUSTED'
  )
}

/**
 * Wrapped fetch that tracks API usage
 * 
 * @example
 * // With explicit provider/scope
 * const { response } = await trackedFetch(url, {
 *   method: 'POST',
 *   provider: 'gemini',
 *   scope: 'gemini-nano-banana-pro',
 * })
 * 
 * // With model ID (auto-mapped to provider/scope)
 * const { response } = await trackedFetch(url, {
 *   method: 'POST',
 *   modelId: 'gemini-nano-banana-pro',
 * })
 */
export async function trackedFetch(
  url: string | URL,
  options: TrackedFetchOptions = {}
): Promise<TrackedFetchResult> {
  const {
    provider: explicitProvider,
    scope: explicitScope,
    modelId,
    skipTracking = false,
    ...fetchOptions
  } = options

  // Determine provider and scope
  let provider: RateLimitProvider | undefined = explicitProvider
  let scope: RateLimitScope | undefined = explicitScope

  if (modelId) {
    provider = provider || getProviderForModel(modelId)
    scope = scope || getScopeForModel(modelId)
  }

  // Check if temporarily blocked
  if (provider && scope && isTemporarilyBlocked(provider, scope)) {
    const remaining = getRemainingBlockTime(provider, scope)
    const error: any = new Error(`Rate limited. Retry after ${remaining}s`)
    error.status = 429
    error.code = 'RESOURCE_EXHAUSTED'
    error.retryAfter = remaining
    throw error
  }

  // Track the request before making it (count attempts, not just successes)
  if (!skipTracking && provider && scope) {
    try {
      await recordApiCall(provider, scope, 1)
    } catch (trackingError) {
      // Don't fail the request if tracking fails
      console.error('[TrackedFetch] Failed to record API call:', trackingError)
    }
  }

  // Make the actual fetch request
  const response = await fetch(url, fetchOptions)

  // Check for rate limit response
  let wasRateLimited = isRateLimitResponse(response)
  let retryAfterSeconds: number | undefined

  if (wasRateLimited) {
    retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'))
    
    if (provider && scope) {
      recordRateLimitError(provider, scope, retryAfterSeconds)
    }
  }

  return {
    response,
    wasRateLimited,
    retryAfterSeconds,
  }
}

/**
 * Helper to check response body for Google-specific rate limit errors
 * Call this after parsing the response body
 */
export function checkGoogleRateLimit(
  responseBody: any,
  provider: RateLimitProvider,
  scope: RateLimitScope
): boolean {
  if (isGoogleRateLimitError(responseBody)) {
    // Extract retry-after from error details if available
    let retryAfter = 60 // Default
    const details = responseBody?.error?.details
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (detail?.retryDelay) {
          // Parse duration string like "30s"
          const match = detail.retryDelay.match(/(\d+)s/)
          if (match) {
            retryAfter = parseInt(match[1], 10)
          }
        }
      }
    }
    
    recordRateLimitError(provider, scope, retryAfter)
    return true
  }
  
  return false
}

/**
 * Get all currently blocked provider/scopes
 */
export function getBlockedProviders(): Array<{ provider: RateLimitProvider; scope: RateLimitScope; remainingSeconds: number }> {
  const blocked: Array<{ provider: RateLimitProvider; scope: RateLimitScope; remainingSeconds: number }> = []
  
  for (const [key, block] of recentRateLimits.entries()) {
    const [provider, scope] = key.split(':') as [RateLimitProvider, RateLimitScope]
    const elapsed = Date.now() - block.timestamp
    const blockDurationMs = block.retryAfter * 1000
    const remaining = Math.max(0, blockDurationMs - elapsed)
    
    if (remaining > 0) {
      blocked.push({
        provider,
        scope,
        remainingSeconds: Math.ceil(remaining / 1000),
      })
    } else {
      // Clean up expired block
      recentRateLimits.delete(key)
    }
  }
  
  return blocked
}

/**
 * Clear a specific block (e.g., after successful request)
 */
export function clearBlock(provider: RateLimitProvider, scope: RateLimitScope): void {
  const key = `${provider}:${scope}`
  recentRateLimits.delete(key)
}
