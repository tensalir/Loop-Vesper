/**
 * Rate limit configuration
 * 
 * Reads configured limits from environment variables with sensible defaults.
 * Supports global limits per provider and per-scope (model) overrides.
 */

export type RateLimitProvider = 'gemini' | 'vertex' | 'replicate' | 'kling'
export type RateLimitWindow = 'minute' | 'month'
export type RateLimitScope = 
  | 'gemini-nano-banana-pro' 
  | 'gemini-veo-3.1' 
  | 'replicate-kling-2.6'
  | 'replicate-nano-banana'
  | 'kling-official'
  | 'global'

export interface RateLimitConfig {
  provider: RateLimitProvider
  scope: RateLimitScope
  rpm: number // Requests per minute
  monthly: number // Requests per month
}

export interface ProviderLimits {
  rpm: number
  monthly: number
}

// Default limits based on documented/observed rates
// Google Gemini API Developer tier - conservative estimates
const DEFAULT_GEMINI_RPM = 10
const DEFAULT_GEMINI_MONTHLY = 1500

// Nano Banana Pro specific (observed to be more restrictive)
const DEFAULT_NANO_BANANA_RPM = 5
const DEFAULT_NANO_BANANA_MONTHLY = 1000

// Veo 3.1 specific (documented as 10 RPM per project)
const DEFAULT_VEO_RPM = 10
const DEFAULT_VEO_MONTHLY = 1000

// Replicate - generous limits on paid tier
const DEFAULT_REPLICATE_RPM = 100
const DEFAULT_REPLICATE_MONTHLY = 10000

// Kling Official API - conservative limits
const DEFAULT_KLING_RPM = 10
const DEFAULT_KLING_MONTHLY = 500

/**
 * Get rate limits for a specific provider and scope
 */
export function getRateLimits(provider: RateLimitProvider, scope: RateLimitScope): ProviderLimits {
  // Check for scope-specific overrides first
  if (provider === 'gemini' || provider === 'vertex') {
    if (scope === 'gemini-nano-banana-pro') {
      return {
        rpm: parseInt(process.env.GEMINI_NANO_BANANA_RPM || '', 10) || DEFAULT_NANO_BANANA_RPM,
        monthly: parseInt(process.env.GEMINI_NANO_BANANA_MONTHLY || '', 10) || DEFAULT_NANO_BANANA_MONTHLY,
      }
    }
    if (scope === 'gemini-veo-3.1') {
      return {
        rpm: parseInt(process.env.GEMINI_VEO_RPM || '', 10) || DEFAULT_VEO_RPM,
        monthly: parseInt(process.env.GEMINI_VEO_MONTHLY || '', 10) || DEFAULT_VEO_MONTHLY,
      }
    }
    // Global Gemini limits
    return {
      rpm: parseInt(process.env.GEMINI_RPM || '', 10) || DEFAULT_GEMINI_RPM,
      monthly: parseInt(process.env.GEMINI_MONTHLY || '', 10) || DEFAULT_GEMINI_MONTHLY,
    }
  }

  if (provider === 'replicate') {
    // Replicate typically has generous limits
    return {
      rpm: parseInt(process.env.REPLICATE_RPM || '', 10) || DEFAULT_REPLICATE_RPM,
      monthly: parseInt(process.env.REPLICATE_MONTHLY || '', 10) || DEFAULT_REPLICATE_MONTHLY,
    }
  }

  if (provider === 'kling') {
    // Kling Official API limits
    return {
      rpm: parseInt(process.env.KLING_RPM || '', 10) || DEFAULT_KLING_RPM,
      monthly: parseInt(process.env.KLING_MONTHLY || '', 10) || DEFAULT_KLING_MONTHLY,
    }
  }

  // Fallback
  return {
    rpm: DEFAULT_GEMINI_RPM,
    monthly: DEFAULT_GEMINI_MONTHLY,
  }
}

/**
 * Map model ID to provider
 */
export function getProviderForModel(modelId: string): RateLimitProvider {
  if (modelId.startsWith('gemini-') || modelId.includes('veo')) {
    return 'gemini'
  }
  if (modelId.startsWith('replicate-')) {
    return 'replicate'
  }
  if (modelId.startsWith('kling-')) {
    return 'kling'
  }
  // Default to gemini for unknown models
  return 'gemini'
}

/**
 * Map model ID to scope
 */
export function getScopeForModel(modelId: string): RateLimitScope {
  if (modelId === 'gemini-nano-banana-pro') {
    return 'gemini-nano-banana-pro'
  }
  if (modelId === 'gemini-veo-3.1') {
    return 'gemini-veo-3.1'
  }
  if (modelId === 'replicate-kling-2.6') {
    return 'replicate-kling-2.6'
  }
  if (modelId === 'kling-official') {
    return 'kling-official'
  }
  // Replicate fallback for Nano Banana
  if (modelId.includes('nano-banana') && !modelId.startsWith('gemini-')) {
    return 'replicate-nano-banana'
  }
  return 'global'
}

/**
 * Get the current minute bucket string (UTC)
 * Format: '2026-01-12T09:31Z'
 */
export function getCurrentMinuteBucket(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const hour = String(now.getUTCHours()).padStart(2, '0')
  const minute = String(now.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}Z`
}

/**
 * Get the current month bucket string (UTC)
 * Format: '2026-01'
 */
export function getCurrentMonthBucket(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Get the time until the next minute bucket resets (in seconds)
 */
export function getSecondsUntilMinuteReset(): number {
  const now = new Date()
  const seconds = now.getUTCSeconds()
  return 60 - seconds
}

/**
 * Get the time until the next month bucket resets (in seconds)
 */
export function getSecondsUntilMonthReset(): number {
  const now = new Date()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
  return Math.floor((nextMonth.getTime() - now.getTime()) / 1000)
}

/**
 * Check if we're near the configured limit (within 20%)
 */
export function isNearLimit(used: number, limit: number): boolean {
  return used >= limit * 0.8
}

/**
 * Check if limit is exceeded
 */
export function isLimitExceeded(used: number, limit: number): boolean {
  return used >= limit
}
