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
 * The store and `waitUntil` are injected so the logic is testable without a
 * database or a Vercel runtime.
 */

export const DEFAULT_SYNC_BUDGET_MS = 50_000
/** A `processing` job older than this has lost its worker. */
export const STALE_PROCESSING_MS = 6 * 60_000
/** A `queued` job older than this is picked up by the sweeper. */
export const QUEUED_PICKUP_MS = 60_000

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
  /** Mark `processing` jobs started before `olderThan` as failed; returns how many. */
  failStale(olderThan: Date, message: string): Promise<number>
  listQueued(olderThan: Date, limit: number): Promise<JobRecord[]>
}

export type WaitUntil = (promise: Promise<unknown>) => void

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
  work: (jobId: string) => Promise<T>
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
      await input.store.complete(job.id, input.toPayload(result))
      return { ok: true as const, result }
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
          if (outcome.ok) await after(outcome.result)
        })
        .catch(() => undefined)
    }
    return { kind: 'handoff', jobId: job.id }
  }

  if (!first.ok) throw first.error
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

/** A job still marked processing long after it started has no worker left. */
export function isStale(job: Pick<JobRecord, 'status' | 'startedAt' | 'updatedAt'>, now = Date.now()): boolean {
  if (job.status !== 'processing') return false
  const since = (job.startedAt ?? job.updatedAt).getTime()
  return now - since > STALE_PROCESSING_MS
}

export const STALE_MESSAGE = 'The worker running this job was lost. Run the call again.'
