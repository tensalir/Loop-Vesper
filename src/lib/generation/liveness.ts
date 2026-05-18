/**
 * Backend-aware liveness helpers for `Generation` rows.
 *
 * Why this module exists
 * ----------------------
 * A `processing` row can be **alive** for several reasons that have nothing to
 * do with the heartbeat field on `parameters`:
 *
 * 1. A Replicate webhook prediction is in flight — completion will arrive via
 *    `/api/webhooks/replicate`, not via the local processor. Heartbeats stop
 *    after `process:skipped-webhook-active`, but the job is healthy.
 * 2. The provider router intentionally rescheduled the job (`routingDelayed`
 *    + `routingRetryAt`) because both providers were rate-limited — the queue
 *    will pick it back up after the cool-off window.
 * 3. The backend has been actively writing fresh heartbeats from the model
 *    polling loop (the normal path).
 *
 * Frontend-only signals (e.g. browser timer drift while the tab was hidden)
 * are NOT enough evidence to mark a job stuck, and the cleanup endpoint must
 * not flip such jobs to `failed`. This module centralises that logic so the
 * cleanup endpoint, the gallery UI, and any future consumer cannot drift.
 *
 * All inputs are read-only. Nothing here writes to the database.
 */

/** Default thresholds — chosen to be conservative so we never falsely fail. */
export const LIVENESS_DEFAULT_THRESHOLDS = {
  /** Min age before the cleanup heuristic will *consider* a row stuck. */
  MIN_AGE_MINUTES: 15,
  /** Heartbeat older than this counts as stale (when a heartbeat was ever written). */
  HEARTBEAT_STALE_MINUTES: 8,
  /** Webhook predictions have this long to complete before they look stuck. */
  WEBHOOK_GRACE_MINUTES: 30,
  /** Routing-delayed jobs get a small buffer past their retry time. */
  ROUTING_RETRY_GRACE_MINUTES: 5,
  /** UI-only: image generations longer than this with no progress look "delayed". */
  UI_IMAGE_DELAYED_MINUTES: 5,
  /** UI-only: video generations longer than this with no progress look "delayed". */
  UI_VIDEO_DELAYED_MINUTES: 12,
} as const

/** Subset of `Generation` we need. Keep narrow to avoid coupling. */
export interface GenerationLikeForLiveness {
  status: string
  createdAt: Date | string
  parameters?: Record<string, unknown> | null
}

export type LivenessReason =
  | 'webhook-active'
  | 'webhook-grace-elapsed'
  | 'routing-retry-pending'
  | 'routing-retry-elapsed'
  | 'heartbeat-fresh'
  | 'heartbeat-stale'
  | 'no-heartbeat-recent'
  | 'no-heartbeat-old'
  | 'terminal'
  | 'too-young'

export interface LivenessAssessment {
  /**
   * True when there is positive evidence the job is still progressing, or
   * when there is not enough evidence to conclude it is stuck.
   *
   * Conservative by design: when in doubt, this returns `true` so the cleanup
   * job leaves the row alone.
   */
  isAlive: boolean
  /** True only when we have strong evidence the job is no longer making progress. */
  isStuck: boolean
  /** True when the row is awaiting a Replicate webhook callback. */
  isWebhookActive: boolean
  /** True when the row was rescheduled by the provider router and hasn't reached its retry time. */
  isRoutingRetryPending: boolean
  /** Age of the generation in minutes. */
  ageMinutes: number
  /** Heartbeat age in minutes, or null when no heartbeat was ever written. */
  heartbeatAgeMinutes: number | null
  /** Webhook submission age in minutes, or null when no webhook was used. */
  webhookAgeMinutes: number | null
  reason: LivenessReason
}

function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/**
 * True when the row is awaiting a Replicate webhook callback and the webhook
 * grace window has not elapsed.
 *
 * `submittedAt` (ISO string) is set in `/api/generate` when the webhook
 * pathway is taken; if it is missing we fall back to `createdAt`.
 */
export function isWebhookStillActive(
  generation: GenerationLikeForLiveness,
  now: number = Date.now(),
  graceMinutes: number = LIVENESS_DEFAULT_THRESHOLDS.WEBHOOK_GRACE_MINUTES
): boolean {
  const params = (generation.parameters as Record<string, unknown> | null | undefined) || null
  if (!params) return false
  const predictionId = typeof params.replicatePredictionId === 'string' ? params.replicatePredictionId : null
  if (!predictionId) return false

  const submittedMs =
    toMs(params.submittedAt) ??
    toMs(params.webhookSubmittedAt) ??
    toMs(generation.createdAt)
  if (submittedMs === null) {
    // We have a prediction id but no anchor for its age — treat as active to
    // avoid false positives. The webhook will still resolve it.
    return true
  }
  return now - submittedMs <= graceMinutes * 60 * 1000
}

/**
 * True when the row has a routing-retry scheduled in the (near) future and
 * therefore the queue should pick it up — not the cleanup endpoint.
 */
export function isRoutingRetryPending(
  generation: GenerationLikeForLiveness,
  now: number = Date.now(),
  graceMinutes: number = LIVENESS_DEFAULT_THRESHOLDS.ROUTING_RETRY_GRACE_MINUTES
): boolean {
  const params = (generation.parameters as Record<string, unknown> | null | undefined) || null
  if (!params) return false
  if (params.routingDelayed !== true) return false
  const retryAtMs = toMs(params.routingRetryAt)
  if (retryAtMs === null) return true // delayed but no anchor — be safe
  return retryAtMs + graceMinutes * 60 * 1000 >= now
}

/**
 * Read the most recent heartbeat (in ms epoch) written by the background
 * processor, or null when none has ever been written.
 */
export function readHeartbeatMs(
  generation: GenerationLikeForLiveness
): number | null {
  const params = (generation.parameters as Record<string, unknown> | null | undefined) || null
  if (!params) return null
  return toMs(params.lastHeartbeatAt)
}

/**
 * Return a structured liveness assessment for a single generation row.
 *
 * Decision order (first match wins):
 *  1. Already terminal → `isAlive: true`, `isStuck: false`, reason `terminal`.
 *  2. Younger than `minAgeMinutes` → conservative; treat as alive.
 *  3. Webhook active inside grace window → alive.
 *  4. Routing retry pending → alive.
 *  5. Fresh heartbeat → alive.
 *  6. Stale heartbeat past threshold → stuck.
 *  7. No heartbeat at all but row is recent → alive (model may not have
 *     started writing yet).
 *  8. No heartbeat at all and row is old AND no webhook AND no routing retry
 *     → stuck.
 */
export function assessGenerationLiveness(
  generation: GenerationLikeForLiveness,
  options: {
    now?: number
    minAgeMinutes?: number
    heartbeatStaleMinutes?: number
    webhookGraceMinutes?: number
    routingRetryGraceMinutes?: number
  } = {}
): LivenessAssessment {
  const now = options.now ?? Date.now()
  const minAgeMinutes = options.minAgeMinutes ?? LIVENESS_DEFAULT_THRESHOLDS.MIN_AGE_MINUTES
  const heartbeatStaleMinutes =
    options.heartbeatStaleMinutes ?? LIVENESS_DEFAULT_THRESHOLDS.HEARTBEAT_STALE_MINUTES
  const webhookGraceMinutes =
    options.webhookGraceMinutes ?? LIVENESS_DEFAULT_THRESHOLDS.WEBHOOK_GRACE_MINUTES
  const routingRetryGraceMinutes =
    options.routingRetryGraceMinutes ?? LIVENESS_DEFAULT_THRESHOLDS.ROUTING_RETRY_GRACE_MINUTES

  const createdAtMs = toMs(generation.createdAt) ?? now
  const ageMinutes = (now - createdAtMs) / (60 * 1000)

  const heartbeatMs = readHeartbeatMs(generation)
  const heartbeatAgeMinutes =
    heartbeatMs !== null ? (now - heartbeatMs) / (60 * 1000) : null

  const params = (generation.parameters as Record<string, unknown> | null | undefined) || null
  const submittedMs = params
    ? toMs(params.submittedAt) ?? toMs(params.webhookSubmittedAt)
    : null
  const webhookAgeMinutes =
    submittedMs !== null ? (now - submittedMs) / (60 * 1000) : null

  if (
    generation.status === 'completed' ||
    generation.status === 'failed' ||
    generation.status === 'cancelled' ||
    generation.status === 'dismissed'
  ) {
    return {
      isAlive: true,
      isStuck: false,
      isWebhookActive: false,
      isRoutingRetryPending: false,
      ageMinutes,
      heartbeatAgeMinutes,
      webhookAgeMinutes,
      reason: 'terminal',
    }
  }

  const isWebhookActive = isWebhookStillActive(generation, now, webhookGraceMinutes)
  const isRoutingRetry = isRoutingRetryPending(generation, now, routingRetryGraceMinutes)

  if (ageMinutes < minAgeMinutes) {
    return {
      isAlive: true,
      isStuck: false,
      isWebhookActive,
      isRoutingRetryPending: isRoutingRetry,
      ageMinutes,
      heartbeatAgeMinutes,
      webhookAgeMinutes,
      reason: 'too-young',
    }
  }

  if (isWebhookActive) {
    return {
      isAlive: true,
      isStuck: false,
      isWebhookActive: true,
      isRoutingRetryPending: isRoutingRetry,
      ageMinutes,
      heartbeatAgeMinutes,
      webhookAgeMinutes,
      reason: 'webhook-active',
    }
  }

  if (isRoutingRetry) {
    return {
      isAlive: true,
      isStuck: false,
      isWebhookActive: false,
      isRoutingRetryPending: true,
      ageMinutes,
      heartbeatAgeMinutes,
      webhookAgeMinutes,
      reason: 'routing-retry-pending',
    }
  }

  if (heartbeatAgeMinutes !== null) {
    if (heartbeatAgeMinutes <= heartbeatStaleMinutes) {
      return {
        isAlive: true,
        isStuck: false,
        isWebhookActive: false,
        isRoutingRetryPending: false,
        ageMinutes,
        heartbeatAgeMinutes,
        webhookAgeMinutes,
        reason: 'heartbeat-fresh',
      }
    }
    return {
      isAlive: false,
      isStuck: true,
      isWebhookActive: false,
      isRoutingRetryPending: false,
      ageMinutes,
      heartbeatAgeMinutes,
      webhookAgeMinutes,
      reason: 'heartbeat-stale',
    }
  }

  // No heartbeat at all. Combine with age before declaring stuck so a row
  // that the processor has not even reached yet is not immediately killed.
  const noHeartbeatStuckAgeMinutes = minAgeMinutes + heartbeatStaleMinutes
  if (ageMinutes < noHeartbeatStuckAgeMinutes) {
    return {
      isAlive: true,
      isStuck: false,
      isWebhookActive: false,
      isRoutingRetryPending: false,
      ageMinutes,
      heartbeatAgeMinutes: null,
      webhookAgeMinutes,
      reason: 'no-heartbeat-recent',
    }
  }
  return {
    isAlive: false,
    isStuck: true,
    isWebhookActive: false,
    isRoutingRetryPending: false,
    ageMinutes,
    heartbeatAgeMinutes: null,
    webhookAgeMinutes,
    reason: 'no-heartbeat-old',
  }
}

/**
 * UI variant of liveness assessment for the gallery's "Delayed" / "Taking
 * unusually long" copy.
 *
 * The gallery cannot wait the full `MIN_AGE_MINUTES` window before telling
 * the user something looks slow, so it uses tighter thresholds for the
 * cosmetic state. CRUCIALLY, the same backend-aware bypasses still apply:
 * a webhook-active or routing-retry job is never shown as "Delayed".
 */
export interface UiDelayedAssessment {
  /** True when the row has been processing visibly longer than expected. */
  isTakingLong: boolean
  /** True when we have evidence to display the strong "Taking unusually long" panel. */
  isLikelyStuck: boolean
  /** Backend-aware reason the row is alive (overrides the stuck visual). */
  awaitingReason: 'webhook' | 'routing-retry' | null
  ageMinutes: number
  heartbeatAgeMinutes: number | null
}

export function assessGenerationForGallery(
  generation: GenerationLikeForLiveness,
  options: {
    isVideo?: boolean
    now?: number
  } = {}
): UiDelayedAssessment {
  const now = options.now ?? Date.now()
  const isVideo = options.isVideo === true

  const liveness = assessGenerationLiveness(generation, {
    now,
    minAgeMinutes: isVideo
      ? LIVENESS_DEFAULT_THRESHOLDS.UI_VIDEO_DELAYED_MINUTES
      : LIVENESS_DEFAULT_THRESHOLDS.UI_IMAGE_DELAYED_MINUTES,
  })

  const ageMinutes = liveness.ageMinutes
  const heartbeatAgeMinutes = liveness.heartbeatAgeMinutes

  const longThresholdMinutes = isVideo ? 2 : 1
  const isTakingLong = ageMinutes > longThresholdMinutes

  if (liveness.isWebhookActive) {
    return {
      isTakingLong,
      isLikelyStuck: false,
      awaitingReason: 'webhook',
      ageMinutes,
      heartbeatAgeMinutes,
    }
  }
  if (liveness.isRoutingRetryPending) {
    return {
      isTakingLong,
      isLikelyStuck: false,
      awaitingReason: 'routing-retry',
      ageMinutes,
      heartbeatAgeMinutes,
    }
  }

  return {
    isTakingLong,
    isLikelyStuck: liveness.isStuck,
    awaitingReason: null,
    ageMinutes,
    heartbeatAgeMinutes,
  }
}
