/**
 * One generation, one set of outputs, and a stored file is never written twice.
 *
 * Why this module exists (found 2026-10-01)
 * -----------------------------------------
 * `/api/generate/process` is called more than once for the same generation: by the server
 * right after the row is made, by the page as a fallback half a second later, and by the
 * gallery's retry for a generation that looks unstarted. Its lock is `processingStartedAt`
 * inside `parameters`, and later writes spread a copy of `parameters` read before the lock was
 * taken, which erased it. The next call then took the lock as well and drew the image again.
 * Both runs wrote `<user>/<generation>/0.jpg` (upsert) and each added an output row. A feed card
 * that had fetched its resized copy between the two writes kept the first picture, while the
 * preview and the download opened the second: the same subject, a different image, and no way
 * back to the first. From 2026-09-28 to 2026-10-01 most Gemini image generations were drawn
 * twice, and paid for twice.
 *
 * So a run writes its files under a name of its own (`<index>-<run>.<ext>`, never over another
 * run's), checks the generation is still open before it uploads, and publishes its outputs in
 * one transaction with the status change, only while the generation is still open. A run that
 * loses publishes nothing and removes what it uploaded.
 *
 * Nothing here imports server code; the route supplies the database and storage.
 */

import { randomUUID } from 'crypto'

/** A short name for one run of the processor; part of every file it writes. */
export function newRunTag(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}

/**
 * Where a run stores output `index` of a generation. Two runs of the same generation never
 * share a path, so a file, once written, is the picture its output row names for good, and a
 * resized copy cached under its address cannot go stale.
 */
export function generationOutputPath(args: {
  userId: string
  generationId: string
  index: number
  extension: string
  runTag: string
}): string {
  const { userId, generationId, index, extension, runTag } = args
  if (!/^[a-z0-9]+$/i.test(runTag)) throw new Error('generationOutputPath: runTag must be alphanumeric')
  return `${userId}/${generationId}/${index}-${runTag}.${extension}`
}

/**
 * Statuses a finished run may publish over. `failed` stays open, as before: a sibling run that
 * failed does not cancel a draw that succeeded.
 */
export const PUBLISHABLE_STATUSES = ['processing', 'failed'] as const

/** True when another run already published this generation, or the person cancelled it. */
export function isSuperseded(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'cancelled'
}

export interface OutputRow {
  generationId: string
  fileUrl: string
  fileType: string
  width?: number | null
  height?: number | null
  duration?: number | null
}

/** The two writes publishing needs, inside one transaction. Prisma's transaction client fits. */
export interface PublishTx {
  generation: {
    updateMany(args: {
      where: { id: string; status: { in: string[] } }
      data: Record<string, unknown>
    }): Promise<{ count: number }>
  }
  output: {
    createMany(args: { data: OutputRow[] }): Promise<{ count: number }>
  }
}

export interface PublishStore {
  /** Run `work` in one database transaction. */
  transaction<T>(work: (tx: PublishTx) => Promise<T>): Promise<T>
}

export type PublishOutcome = 'published' | 'superseded'

/**
 * Mark the generation completed and add its outputs, in one transaction, only if no other run
 * got there first. The status update takes the row lock, so of two runs finishing together the
 * second waits, finds the generation completed, and writes nothing.
 */
export async function publishOutputsOnce(
  store: PublishStore,
  args: { generationId: string; outputs: OutputRow[]; completion: Record<string, unknown> }
): Promise<PublishOutcome> {
  return store.transaction(async (tx) => {
    const closed = await tx.generation.updateMany({
      where: { id: args.generationId, status: { in: [...PUBLISHABLE_STATUSES] } },
      data: { ...args.completion, status: 'completed' },
    })
    if (closed.count === 0) return 'superseded'
    await tx.output.createMany({ data: args.outputs })
    return 'published'
  })
}
