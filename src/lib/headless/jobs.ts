/**
 * Long MCP calls: run once, answer inline when quick, hand back a job when not.
 *
 * What this replaces: `generate_asset` with `async: true` stored its own
 * arguments (the `async` flag still on) as a queued job, and polling ran the
 * tool entry again on those arguments, which queued a new job and completed
 * the first with a "queued" result. Every poll produced another job and no
 * image. Jobs also only ran when someone polled.
 *
 * Now a long call:
 *   1. inserts its job as `processing`, with `async` stripped from the stored
 *      request, so nothing can re-queue it;
 *   2. starts the work at once and hands it to `waitUntil`, so it finishes
 *      even after the response is sent;
 *   3. races the work against a budget (`MCP_SYNC_BUDGET_MS`, 50 s by
 *      default; 0 when the caller asked for `async`). If the work settles in
 *      time the result goes back inline; otherwise the caller gets the job id
 *      and collects the result with `get_generation_status`.
 *
 * A job record holds structured results and output ids, never base64: the
 * poll rebuilds previews from storage.
 *
 * A video the provider renders for minutes is not waited on at all (since
 * 2026-10-12). The work submits it and hands off: the job keeps the
 * provider's handle (`result.pending`) and stays `processing`, and
 * `get_generation_status` and the minute sweeper check the provider and
 * finish it. Until then a render past the 240 s wall was given up on while
 * the provider went on (and billed): 6 of 22 Seedance videos asked for
 * through Claude, and 1 in 5 of Kling's 10 s start-and-end-frame renders.
 *
 * The store and `waitUntil` are injected so the logic is testable without a
 * database or a Vercel runtime.
 */

export const DEFAULT_SYNC_BUDGET_MS = 50_000
/** A `processing` job older than this has lost its worker. */
export const STALE_PROCESSING_MS = 6 * 60_000
/** A `queued` job older than this is picked up by the sweeper. */
export const QUEUED_PICKUP_MS = 60_000
/**
 * A handed-off job waits on its provider, not on a worker, so it goes stale only after this.
 * Kling 3.0 took 9 minutes for 15 s at 1080p with audio on Replicate's own example.
 */
export const PENDING_MAX_MS = 30 * 60_000
/** How long the one worker that finishes a handed-off job holds it. */
export const FINISH_LEASE_MS = 4 * 60_000

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

/** What a finished job stores. Never image bytes. */
export interface JobPayload {
  summary: string
  structuredContent: Record<string, unknown>
  outputIds: string[]
  costUsd: number | null
}

export interface JobRecord {
  id: string
  credentialId: string
  ownerId: string
  toolName: string
  modelId: string
  status: JobStatus
  request: Record<string, unknown>
  /** A `JobPayload` for jobs written by this code; older rows hold a full MCP result. */
  result: unknown
  error: string | null
  attempts: number
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

export interface JobStore {
  create(input: {
    credentialId: string
    ownerId: string
    toolName: string
    modelId: string
    request: Record<string, unknown>
  }): Promise<{ id: string }>
  complete(id: string, payload: JobPayload): Promise<void>
  fail(id: string, message: string): Promise<void>
  /** queued → processing, once. False when someone else claimed it first. */
  claimQueued(id: string): Promise<boolean>
  get(id: string, ownerId: string): Promise<JobRecord | null>
  /**
   * Mark `processing` jobs started before `olderThan` as failed; returns how many. A job waiting
   * on its provider is not one of them until `PENDING_MAX_MS` after its submit, and then fails
   * with `PENDING_STALE_MESSAGE`.
   */
  failStale(olderThan: Date, message: string): Promise<number>
  listQueued(olderThan: Date, limit: number): Promise<JobRecord[]>
  /** Keep the provider's handle on a `processing` job (`result.pending`). */
  setPending(id: string, pending: PendingHandle): Promise<void>
  /** Take the right to finish a handed-off job until `until`; false when another caller holds it. */
  leasePending(id: string, until: Date): Promise<boolean>
  /** Give the right back, so a later check can finish the job. */
  releasePending(id: string): Promise<void>
  /** Jobs still waiting on their provider, the longest-untouched first. */
  listPending(limit: number): Promise<JobRecord[]>
}

export type WaitUntil = (promise: Promise<unknown>) => void

/** What a provider-rendered job keeps while the provider works. */
export interface PendingHandle {
  provider: string
  predictionId: string
  /** ISO time of the submit; the job goes stale `PENDING_MAX_MS` after it. */
  submittedAt: string
  /** Set while one caller finishes the job, so a second does not finish it again. */
  leaseUntil?: string | null
  [key: string]: unknown
}

/**
 * What a job's work returns when it handed the render to the provider: the job stays
 * `processing` with its handle, and is finished by whoever next checks it.
 */
export interface HandedOff {
  handedOff: true
}

export const HANDED_OFF: HandedOff = { handedOff: true }

export function isHandedOff(value: unknown): value is HandedOff {
  return Boolean(value) && typeof value === 'object' && (value as { handedOff?: unknown }).handedOff === true
}

/** The provider handle of a job still waiting on its provider, or null. */
export function pendingOf(job: Pick<JobRecord, 'status' | 'result'>): PendingHandle | null {
  if (job.status !== 'processing') return null
  const pending = (job.result as { pending?: unknown } | null)?.pending
  if (!pending || typeof pending !== 'object') return null
  const p = pending as Partial<PendingHandle>
  return typeof p.predictionId === 'string' && typeof p.submittedAt === 'string' ? (p as PendingHandle) : null
}

/** Remove the async switch so a stored request can never queue itself again. */
export function stripAsync(request: Record<string, unknown>): Record<string, unknown> {
  const { async: _async, ...rest } = request
  void _async
  return rest
}

export function syncBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
  runAsync = false
): number {
  if (runAsync) return 0
  const raw = Number(env.MCP_SYNC_BUDGET_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SYNC_BUDGET_MS
}

export interface LongRunInput<T> {
  store: JobStore
  waitUntil: WaitUntil
  credentialId: string
  ownerId: string
  toolName: string
  modelId: string
  request: Record<string, unknown>
  budgetMs: number
  /** The work itself, given its job id; must not go back through the tool entry. */
  work: (jobId: string) => Promise<T | HandedOff>
  /** What to store when the work succeeds. */
  toPayload: (result: T) => JobPayload
  /** Called when the work finished after the caller was handed the job id. */
  onBackgroundDone?: (result: T) => Promise<void> | void
}

export type LongRunOutcome<T> =
  | { kind: 'inline'; jobId: string; result: T }
  | { kind: 'handoff'; jobId: string }

export async function runWithBudget<T>(input: LongRunInput<T>): Promise<LongRunOutcome<T>> {
  const job = await input.store.create({
    credentialId: input.credentialId,
    ownerId: input.ownerId,
    toolName: input.toolName,
    modelId: input.modelId,
    request: stripAsync(input.request),
  })

  const settled = input
    .work(job.id)
    .then(async (result) => {
      // Handed to the provider: the job stays processing, and its finisher completes it.
      if (isHandedOff(result)) return { ok: true as const, handedOff: true as const }
      await input.store.complete(job.id, input.toPayload(result))
      return { ok: true as const, handedOff: false as const, result }
    })
    .catch(async (err: unknown) => {
      const message = (err as Error)?.message || 'Job failed'
      await input.store.fail(job.id, message).catch(() => undefined)
      return { ok: false as const, error: err }
    })

  input.waitUntil(settled)

  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<'budget'>((resolve) => {
    timer = setTimeout(() => resolve('budget'), Math.max(0, input.budgetMs))
  })

  const first = await Promise.race([settled, budget])
  if (timer) clearTimeout(timer)

  if (first === 'budget') {
    if (input.onBackgroundDone) {
      const after = input.onBackgroundDone
      settled
        .then(async (outcome) => {
          if (outcome.ok && !outcome.handedOff) await after(outcome.result)
        })
        .catch(() => undefined)
    }
    return { kind: 'handoff', jobId: job.id }
  }

  if (!first.ok) throw first.error
  if (first.handedOff) return { kind: 'handoff', jobId: job.id }
  return { kind: 'inline', jobId: job.id, result: first.result }
}

/** Read a stored result as a payload; null for older rows written before payloads existed. */
export function asJobPayload(result: unknown): JobPayload | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if (typeof r.summary !== 'string' || !r.structuredContent || !Array.isArray(r.outputIds)) return null
  return {
    summary: r.summary,
    structuredContent: r.structuredContent as Record<string, unknown>,
    outputIds: r.outputIds.filter((id): id is string => typeof id === 'string'),
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : null,
  }
}

/**
 * A job still marked processing long after it started has no worker left. One waiting on its
 * provider needs no worker, and is stale only `PENDING_MAX_MS` after its submit.
 */
export function isStale(
  job: Pick<JobRecord, 'status' | 'startedAt' | 'updatedAt'> & Partial<Pick<JobRecord, 'result'>>,
  now = Date.now()
): boolean {
  if (job.status !== 'processing') return false
  const pending = pendingOf({ status: job.status, result: job.result ?? null })
  if (pending) return now - Date.parse(pending.submittedAt) > PENDING_MAX_MS
  const since = (job.startedAt ?? job.updatedAt).getTime()
  return now - since > STALE_PROCESSING_MS
}

export const STALE_MESSAGE = 'The worker running this job was lost. Run the call again.'
export const PENDING_STALE_MESSAGE =
  'The provider did not finish this video within 30 minutes. Run the call again, or check the provider for the prediction.'

/** The message a stale job fails with: the provider's when it was waiting on one. */
export function staleMessageFor(job: Pick<JobRecord, 'status' | 'result'>): string {
  return pendingOf(job) ? PENDING_STALE_MESSAGE : STALE_MESSAGE
}
