/**
 * Provider routing for automatic failover between Google and Replicate
 * 
 * Routes gemini-* models to Google when available, falling back to Replicate
 * when rate limits are hit. Supports routing back when limits reset.
 */

import { canAcceptRequest, RateLimitStatus } from '@/lib/rate-limits/usage'
import { isTemporarilyBlocked, getRemainingBlockTime } from '@/lib/rate-limits/trackedFetch'
import { RateLimitProvider, RateLimitScope } from '@/lib/rate-limits/config'

export type ProviderRouteDecision = {
  /** The actual provider to use */
  provider: 'google' | 'replicate'
  /** The original model ID requested */
  originalModelId: string
  /** The model ID to use for execution (may differ if fallback) */
  effectiveModelId: string
  /** The model ID to use for billing calculations */
  billingModelId: string
  /** Whether this is a fallback route */
  isFallback: boolean
  /** Reason for the routing decision */
  reason: string
}

export type ProviderRouteError = {
  error: true
  message: string
  retryAfterSeconds?: number
  bothProvidersBlocked?: boolean
}

/**
 * Model ID mappings for fallback routing
 */
const FALLBACK_MAPPINGS: Record<string, { replicateModelId: string; replicateBillingId: string }> = {
  'gemini-nano-banana-pro': {
    replicateModelId: 'replicate-nano-banana-pro',
    replicateBillingId: 'replicate-nano-banana-pro',
  },
  'gemini-veo-3.1': {
    replicateModelId: 'replicate-kling-2.6',
    replicateBillingId: 'replicate-kling-2.6',
  },
}

/**
 * Reverse mapping for routing back to Google
 */
const REVERSE_MAPPINGS: Record<string, string> = {
  'replicate-nano-banana-pro': 'gemini-nano-banana-pro',
  'replicate-kling-2.6': 'gemini-veo-3.1',
}

/**
 * Check if a model supports automatic fallback routing
 */
export function supportsAutoRouting(modelId: string): boolean {
  return modelId in FALLBACK_MAPPINGS
}

/**
 * Get the scope for rate limit checking based on model ID
 */
function getScopeForModel(modelId: string): RateLimitScope {
  if (modelId === 'gemini-nano-banana-pro') return 'gemini-nano-banana-pro'
  if (modelId === 'gemini-veo-3.1') return 'gemini-veo-3.1'
  if (modelId === 'replicate-kling-2.6') return 'replicate-kling-2.6'
  if (modelId === 'replicate-nano-banana-pro') return 'replicate-nano-banana'
  return 'global'
}

/**
 * Determine the best provider route for a given model
 * 
 * @param modelId - The requested model ID (e.g., 'gemini-nano-banana-pro')
 * @returns Route decision or error if both providers are blocked
 */
export async function determineProviderRoute(
  modelId: string
): Promise<ProviderRouteDecision | ProviderRouteError> {
  // Check if this model supports routing
  const fallbackMapping = FALLBACK_MAPPINGS[modelId]
  
  if (!fallbackMapping) {
    // No fallback available, use original model as-is
    return {
      provider: modelId.startsWith('replicate-') ? 'replicate' : 'google',
      originalModelId: modelId,
      effectiveModelId: modelId,
      billingModelId: modelId,
      isFallback: false,
      reason: 'No fallback configured for this model',
    }
  }

  const googleScope = getScopeForModel(modelId)
  const replicateScope = getScopeForModel(fallbackMapping.replicateModelId)

  // Check Google availability
  const googleProvider: RateLimitProvider = 'gemini'
  const googleBlocked = isTemporarilyBlocked(googleProvider, googleScope)
  const googleCheck = googleBlocked 
    ? { allowed: false, status: 'blocked' as RateLimitStatus, reason: `Temporarily blocked, retry in ${getRemainingBlockTime(googleProvider, googleScope)}s` }
    : await canAcceptRequest(googleProvider, googleScope)

  // If Google is available, use it
  if (googleCheck.allowed) {
    return {
      provider: 'google',
      originalModelId: modelId,
      effectiveModelId: modelId,
      billingModelId: modelId,
      isFallback: false,
      reason: 'Google provider available',
    }
  }

  // Google is blocked, check Replicate
  const replicateProvider: RateLimitProvider = 'replicate'
  const replicateBlocked = isTemporarilyBlocked(replicateProvider, replicateScope)
  const replicateCheck = replicateBlocked
    ? { allowed: false, status: 'blocked' as RateLimitStatus, reason: `Temporarily blocked, retry in ${getRemainingBlockTime(replicateProvider, replicateScope)}s` }
    : await canAcceptRequest(replicateProvider, replicateScope)

  // If Replicate is available, use it as fallback
  if (replicateCheck.allowed) {
    console.log(`[ProviderRouter] Routing ${modelId} to Replicate fallback: ${fallbackMapping.replicateModelId}`)
    return {
      provider: 'replicate',
      originalModelId: modelId,
      effectiveModelId: fallbackMapping.replicateModelId,
      billingModelId: fallbackMapping.replicateBillingId,
      isFallback: true,
      reason: `Google rate limited (${googleCheck.reason}), using Replicate fallback`,
    }
  }

  // Both providers are blocked
  const googleRetry = googleBlocked 
    ? getRemainingBlockTime(googleProvider, googleScope)
    : 60 // Default from rate limit
  const replicateRetry = replicateBlocked
    ? getRemainingBlockTime(replicateProvider, replicateScope)
    : 60

  const nextRetry = Math.min(googleRetry, replicateRetry)

  return {
    error: true,
    message: `Both Google (${googleCheck.reason}) and Replicate (${replicateCheck.reason}) are rate limited`,
    retryAfterSeconds: nextRetry,
    bothProvidersBlocked: true,
  }
}

/**
 * Check if we should try routing back to Google from Replicate
 * This is used when a job was previously routed to Replicate but Google may now be available
 * 
 * @param originalModelId - The original model ID (e.g., 'gemini-nano-banana-pro')
 * @returns Whether Google is now available
 */
export async function shouldRouteBackToGoogle(originalModelId: string): Promise<boolean> {
  if (!(originalModelId in FALLBACK_MAPPINGS)) {
    return false
  }

  const googleScope = getScopeForModel(originalModelId)
  const googleProvider: RateLimitProvider = 'gemini'
  
  if (isTemporarilyBlocked(googleProvider, googleScope)) {
    return false
  }

  const check = await canAcceptRequest(googleProvider, googleScope)
  return check.allowed
}

/**
 * Get the original Google model ID from a Replicate fallback model
 * 
 * @param replicateModelId - The Replicate model ID
 * @returns The original Google model ID, or null if not a fallback model
 */
export function getOriginalGoogleModel(replicateModelId: string): string | null {
  return REVERSE_MAPPINGS[replicateModelId] || null
}

/**
 * Store the routing decision in generation parameters
 * This can be used to track which provider was actually used
 * 
 * @param parameters - The existing generation parameters
 * @param route - The routing decision
 * @returns Updated parameters with routing info
 */
export function addRouteToParameters(
  parameters: Record<string, any>,
  route: ProviderRouteDecision
): Record<string, any> {
  return {
    ...parameters,
    providerRoute: {
      provider: route.provider,
      originalModelId: route.originalModelId,
      effectiveModelId: route.effectiveModelId,
      billingModelId: route.billingModelId,
      isFallback: route.isFallback,
      reason: route.reason,
      routedAt: new Date().toISOString(),
    },
  }
}

/**
 * Extract routing info from generation parameters
 */
export function getRouteFromParameters(
  parameters: Record<string, any>
): ProviderRouteDecision | null {
  if (!parameters?.providerRoute) {
    return null
  }

  return {
    provider: parameters.providerRoute.provider,
    originalModelId: parameters.providerRoute.originalModelId,
    effectiveModelId: parameters.providerRoute.effectiveModelId,
    billingModelId: parameters.providerRoute.billingModelId,
    isFallback: parameters.providerRoute.isFallback,
    reason: parameters.providerRoute.reason,
  }
}
