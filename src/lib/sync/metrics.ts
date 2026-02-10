/**
 * Sync health metrics: webhook lag, replay backlog, dedupe rate, projection failures.
 * Used for observability and phased rollout gates.
 */

import { logMetric } from '@/lib/metrics'

export type RolloutPhase = 'observe_only' | 'one_way_projection' | 'bidirectional_sync'

let _rolloutPhase: RolloutPhase = 'observe_only'

export function getSyncRolloutPhase(): RolloutPhase {
  return _rolloutPhase
}

export function setSyncRolloutPhase(phase: RolloutPhase): void {
  _rolloutPhase = phase
}

/**
 * Record webhook received and processing lag (ms from event occurredAt to now).
 */
export function recordWebhookLag(source: 'monday' | 'figma', lagMs: number): void {
  logMetric({
    name: 'sync_webhook_lag',
    durationMs: lagMs,
    status: lagMs < 60_000 ? 'success' : 'error',
    meta: { source, lagMs },
  })
}

/**
 * Record replay/reconciliation run (backlog processed).
 */
export function recordReplayBacklog(
  action: 'reconcile' | 'project',
  processed: number,
  skipped: number
): void {
  logMetric({
    name: 'sync_replay_backlog',
    durationMs: 0,
    status: 'success',
    meta: { action, processed, skipped },
  })
}

/**
 * Record dedupe rate (events skipped as already present).
 */
export function recordDedupeRate(source: string, inserted: number, skipped: number): void {
  const total = inserted + skipped
  const rate = total > 0 ? skipped / total : 0
  logMetric({
    name: 'sync_dedupe_rate',
    durationMs: 0,
    status: 'success',
    meta: { source, inserted, skipped, dedupeRate: rate },
  })
}

/**
 * Record projection failure (Figma->Monday or Monday->Figma).
 */
export function recordProjectionFailure(
  direction: 'figma_to_monday' | 'monday_to_figma',
  linkId: string,
  error: string
): void {
  logMetric({
    name: 'sync_projection_failure',
    durationMs: 0,
    status: 'error',
    meta: { direction, linkId, error },
  })
}
