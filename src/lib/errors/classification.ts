/**
 * Error Classification for API Responses
 * 
 * Maps generation errors to semantically correct HTTP status codes so that
 * dashboards (Vercel, Datadog, etc.) can distinguish between:
 * 
 *   502/503  — upstream provider unavailable (Google, Replicate, Anthropic)
 *   422      — content safety block / prompt rejected (user can rephrase)
 *   429      — rate limited / quota exhausted (wait and retry)
 *   400      — bad request / validation (client bug)
 *   500      — internal server error (our bug)
 */

export type ErrorCategory =
  | 'upstream_unavailable'   // 502 — Google/Replicate/Anthropic is down or erroring
  | 'content_safety'         // 422 — prompt blocked by safety filters
  | 'rate_limited'           // 429 — rate limited or quota exhausted
  | 'validation'             // 400 — bad request, missing params
  | 'auth'                   // 401 — authentication error
  | 'internal'               // 500 — unexpected / our bug

export interface ClassifiedError {
  /** Semantic category of the error */
  category: ErrorCategory
  /** HTTP status code to return */
  httpStatus: number
  /** Whether the client should retry (with backoff) */
  isRetryable: boolean
  /** Human-readable label for dashboards */
  label: string
}

/**
 * Classify an error message into a semantic category with appropriate HTTP status.
 * Pattern-matches against known error strings from our adapters and upstream APIs.
 */
export function classifyError(errorMessage: string): ClassifiedError {
  const msg = (errorMessage || '').toLowerCase()

  // ── Content Safety / Prompt Rejection (422) ──────────────────────────
  // These are user-fixable — the prompt needs to change, not our code.
  if (
    msg.includes('content safety filter') ||
    msg.includes('safety filter') ||
    msg.includes('blocked by safety') ||
    msg.includes('prohibited content') ||
    msg.includes('blocklist') ||
    msg.includes('image_safety') ||
    msg.includes('image safety') ||
    msg.includes('personally identifiable') ||
    msg.includes('spii') ||
    msg.includes('copyrighted material') ||
    msg.includes('recitation') ||
    msg.includes('prompt blocked') ||
    msg.includes('content policy') ||
    msg.includes('responsible ai') ||
    msg.includes('image was blocked') ||
    msg.includes('filtered by content safety') ||
    msg.includes('filtered by google content safety')
  ) {
    return {
      category: 'content_safety',
      httpStatus: 422,
      isRetryable: false,
      label: 'Content Safety Block',
    }
  }

  // ── Rate Limiting / Quota (429) ──────────────────────────────────────
  if (
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('daily quota') ||
    msg.includes('limit: 0') ||
    msg.includes('too many requests') ||
    msg.includes('all apis exhausted') ||
    msg.includes('both providers are rate limited')
  ) {
    return {
      category: 'rate_limited',
      httpStatus: 429,
      isRetryable: true,
      label: 'Rate Limited / Quota',
    }
  }

  // ── Upstream Unavailable (502) ───────────────────────────────────────
  // Google, Replicate, Anthropic, or other providers returning errors
  // that are NOT our fault and NOT the user's fault.
  if (
    msg.includes('service unavailable') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('gateway timeout') ||
    msg.includes('bad gateway') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('replicate generation timeout') ||
    msg.includes('failed to fetch replicate model') ||
    msg.includes('vertex ai authentication failed') ||
    msg.includes('model not available via vertex') ||
    msg.includes('failed to check prediction status') ||
    msg.includes('failed to check operation status') ||
    msg.includes('video generation timeout')
  ) {
    return {
      category: 'upstream_unavailable',
      httpStatus: 502,
      isRetryable: true,
      label: 'Upstream Unavailable',
    }
  }

  // ── Validation / Bad Request (400) ───────────────────────────────────
  if (
    msg.includes('is required') ||
    msg.includes('invalid request') ||
    msg.includes('invalid reference image') ||
    msg.includes('model not found') ||
    msg.includes('session not found') ||
    msg.includes('prompt is required')
  ) {
    return {
      category: 'validation',
      httpStatus: 400,
      isRetryable: false,
      label: 'Validation Error',
    }
  }

  // ── Auth (401) ───────────────────────────────────────────────────────
  if (
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('authorization signature')
  ) {
    return {
      category: 'auth',
      httpStatus: 401,
      isRetryable: false,
      label: 'Authentication Error',
    }
  }

  // ── Default: Internal Server Error (500) ─────────────────────────────
  // If we can't classify it, assume it's our problem.
  return {
    category: 'internal',
    httpStatus: 500,
    isRetryable: false,
    label: 'Internal Error',
  }
}

/**
 * Classify an error and return a structured context object for storage.
 * Includes the original error message plus classification metadata.
 */
export function classifyErrorContext(
  error: string | Error,
  extra?: Record<string, any>
): {
  message: string
  classification: ClassifiedError
} & Record<string, any> {
  const message = typeof error === 'string' ? error : (error.message || 'Unknown error')
  const classification = classifyError(message)

  return {
    message,
    classification,
    ...(extra || {}),
  }
}
