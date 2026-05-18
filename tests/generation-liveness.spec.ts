import { test, expect } from '@playwright/test'
import {
  assessGenerationForGallery,
  assessGenerationLiveness,
  isRoutingRetryPending,
  isWebhookStillActive,
  LIVENESS_DEFAULT_THRESHOLDS,
  type GenerationLikeForLiveness,
} from '../src/lib/generation/liveness'

/**
 * Liveness contract tests for the Studio (Wispr Flow) generation pipeline.
 *
 * These tests pin the rules that prevent a generation from being marked
 * "stuck" or "failed" simply because the user switched tabs / desktops:
 *
 *   1. Webhook-backed Replicate jobs inside their grace window are alive.
 *   2. Routing-delayed jobs with a future `routingRetryAt` are alive.
 *   3. Heartbeat-fresh rows are alive.
 *   4. A heartbeat that is just slightly stale on a recent row does NOT
 *      flip the row to stuck (combined-evidence requirement).
 *   5. Terminal rows are always treated as alive (the cleanup endpoint
 *      must never re-touch them).
 */

const NOW = new Date('2026-05-18T12:00:00.000Z').getTime()
const min = (n: number) => n * 60 * 1000

function gen(over: Partial<GenerationLikeForLiveness>): GenerationLikeForLiveness {
  return {
    status: 'processing',
    createdAt: new Date(NOW - min(20)).toISOString(),
    parameters: {},
    ...over,
  }
}

/* ── Webhook-active rows are alive even with no fresh heartbeat ─── */

test('isWebhookStillActive: prediction inside grace window is active', () => {
  const row = gen({
    parameters: {
      replicatePredictionId: 'pred-abc',
      submittedAt: new Date(NOW - min(10)).toISOString(),
    },
  })
  expect(isWebhookStillActive(row, NOW)).toBe(true)
})

test('isWebhookStillActive: prediction past grace window is NOT active', () => {
  const row = gen({
    parameters: {
      replicatePredictionId: 'pred-abc',
      submittedAt: new Date(
        NOW - min(LIVENESS_DEFAULT_THRESHOLDS.WEBHOOK_GRACE_MINUTES + 5)
      ).toISOString(),
    },
  })
  expect(isWebhookStillActive(row, NOW)).toBe(false)
})

test('isWebhookStillActive: webhook with no submittedAt anchor falls back to alive', () => {
  // We treat unanchored webhook predictions as alive on purpose — better a
  // long-running row than a falsely-failed one. The webhook will resolve.
  const row = gen({
    parameters: {
      replicatePredictionId: 'pred-abc',
    },
  })
  expect(isWebhookStillActive(row, NOW)).toBe(true)
})

test('isWebhookStillActive: row without prediction id is not active', () => {
  expect(isWebhookStillActive(gen({}), NOW)).toBe(false)
})

/* ── Routing-retry rows are alive while their retry hasn't elapsed ── */

test('isRoutingRetryPending: future retry time is pending', () => {
  const row = gen({
    parameters: {
      routingDelayed: true,
      routingRetryAt: new Date(NOW + min(1)).toISOString(),
    },
  })
  expect(isRoutingRetryPending(row, NOW)).toBe(true)
})

test('isRoutingRetryPending: retry well past grace window is NOT pending', () => {
  const row = gen({
    parameters: {
      routingDelayed: true,
      routingRetryAt: new Date(
        NOW - min(LIVENESS_DEFAULT_THRESHOLDS.ROUTING_RETRY_GRACE_MINUTES + 5)
      ).toISOString(),
    },
  })
  expect(isRoutingRetryPending(row, NOW)).toBe(false)
})

/* ── Top-level assessGenerationLiveness contract ─────────────────── */

test('terminal rows are always alive and never stuck', () => {
  for (const status of ['completed', 'failed', 'cancelled', 'dismissed']) {
    const a = assessGenerationLiveness(
      gen({ status, createdAt: new Date(NOW - min(60)).toISOString() }),
      { now: NOW }
    )
    expect(a.isAlive).toBe(true)
    expect(a.isStuck).toBe(false)
    expect(a.reason).toBe('terminal')
  }
})

test('webhook-active row past min age is alive', () => {
  const row = gen({
    createdAt: new Date(NOW - min(45)).toISOString(),
    parameters: {
      replicatePredictionId: 'pred-abc',
      submittedAt: new Date(NOW - min(20)).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isAlive).toBe(true)
  expect(a.isStuck).toBe(false)
  expect(a.reason).toBe('webhook-active')
  expect(a.isWebhookActive).toBe(true)
})

test('webhook-active row past grace window with no heartbeat is stuck', () => {
  // After WEBHOOK_GRACE_MINUTES we no longer trust the webhook to resolve
  // the row. Combined with the missing heartbeat and the row being older
  // than (MIN_AGE + HEARTBEAT_STALE), the cleanup endpoint should pick it
  // up.
  const row = gen({
    createdAt: new Date(
      NOW - min(LIVENESS_DEFAULT_THRESHOLDS.MIN_AGE_MINUTES + LIVENESS_DEFAULT_THRESHOLDS.HEARTBEAT_STALE_MINUTES + 5)
    ).toISOString(),
    parameters: {
      replicatePredictionId: 'pred-abc',
      submittedAt: new Date(
        NOW - min(LIVENESS_DEFAULT_THRESHOLDS.WEBHOOK_GRACE_MINUTES + 10)
      ).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isStuck).toBe(true)
  expect(a.reason).toBe('no-heartbeat-old')
})

test('routing-retry pending overrides stale heartbeat', () => {
  const row = gen({
    createdAt: new Date(NOW - min(45)).toISOString(),
    parameters: {
      routingDelayed: true,
      routingRetryAt: new Date(NOW + min(2)).toISOString(),
      lastHeartbeatAt: new Date(NOW - min(20)).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isAlive).toBe(true)
  expect(a.isStuck).toBe(false)
  expect(a.reason).toBe('routing-retry-pending')
  expect(a.isRoutingRetryPending).toBe(true)
})

test('fresh heartbeat marks row alive even with old createdAt', () => {
  const row = gen({
    createdAt: new Date(NOW - min(45)).toISOString(),
    parameters: {
      lastHeartbeatAt: new Date(NOW - min(1)).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isAlive).toBe(true)
  expect(a.reason).toBe('heartbeat-fresh')
})

test('stale heartbeat past threshold marks row stuck', () => {
  const row = gen({
    createdAt: new Date(NOW - min(LIVENESS_DEFAULT_THRESHOLDS.MIN_AGE_MINUTES + 5)).toISOString(),
    parameters: {
      lastHeartbeatAt: new Date(
        NOW - min(LIVENESS_DEFAULT_THRESHOLDS.HEARTBEAT_STALE_MINUTES + 5)
      ).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isStuck).toBe(true)
  expect(a.reason).toBe('heartbeat-stale')
})

test('young row with no heartbeat is alive (processor may not have started)', () => {
  // A row created 2 minutes ago with no heartbeat is NOT stuck — the
  // background processor may not have written the first heartbeat yet, or
  // the queue may be reaching it shortly. The browser must not panic.
  const row = gen({
    createdAt: new Date(NOW - min(2)).toISOString(),
    parameters: {},
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isAlive).toBe(true)
  expect(a.reason).toBe('too-young')
})

test('pre-min-age row never stuck even with stale heartbeat', () => {
  // A row inside the min-age window is shielded by the `too-young` branch
  // regardless of heartbeat staleness. This is what stops a tab returning
  // from background from killing a healthy ~5min generation.
  const row = gen({
    createdAt: new Date(NOW - min(LIVENESS_DEFAULT_THRESHOLDS.MIN_AGE_MINUTES - 1)).toISOString(),
    parameters: {
      lastHeartbeatAt: new Date(
        NOW - min(LIVENESS_DEFAULT_THRESHOLDS.HEARTBEAT_STALE_MINUTES + 10)
      ).toISOString(),
    },
  })
  const a = assessGenerationLiveness(row, { now: NOW })
  expect(a.isAlive).toBe(true)
  expect(a.isStuck).toBe(false)
  expect(a.reason).toBe('too-young')
})

/* ── Gallery UI assessment ────────────────────────────────────────── */

test('gallery: webhook-active row shows awaitingReason=webhook, not stuck', () => {
  const row = gen({
    createdAt: new Date(NOW - min(20)).toISOString(),
    parameters: {
      replicatePredictionId: 'pred-abc',
      submittedAt: new Date(NOW - min(15)).toISOString(),
    },
  })
  const a = assessGenerationForGallery(row, { now: NOW, isVideo: false })
  expect(a.awaitingReason).toBe('webhook')
  expect(a.isLikelyStuck).toBe(false)
})

test('gallery: routing-retry row shows awaitingReason=routing-retry, not stuck', () => {
  const row = gen({
    createdAt: new Date(NOW - min(20)).toISOString(),
    parameters: {
      routingDelayed: true,
      routingRetryAt: new Date(NOW + min(1)).toISOString(),
    },
  })
  const a = assessGenerationForGallery(row, { now: NOW, isVideo: false })
  expect(a.awaitingReason).toBe('routing-retry')
  expect(a.isLikelyStuck).toBe(false)
})

test('gallery: video model is not flagged stuck inside its 12-min budget', () => {
  // A video that has been processing for 8 minutes with no heartbeat is
  // common during the model call. It must NOT show as Delayed.
  const row = gen({
    createdAt: new Date(NOW - min(8)).toISOString(),
    parameters: {},
  })
  const a = assessGenerationForGallery(row, { now: NOW, isVideo: true })
  expect(a.isLikelyStuck).toBe(false)
})

test('gallery: image model with very stale heartbeat past UI threshold is likely stuck', () => {
  const row = gen({
    createdAt: new Date(
      NOW - min(LIVENESS_DEFAULT_THRESHOLDS.UI_IMAGE_DELAYED_MINUTES + 5)
    ).toISOString(),
    parameters: {
      lastHeartbeatAt: new Date(NOW - min(15)).toISOString(),
    },
  })
  const a = assessGenerationForGallery(row, { now: NOW, isVideo: false })
  expect(a.isLikelyStuck).toBe(true)
  expect(a.awaitingReason).toBeNull()
})
