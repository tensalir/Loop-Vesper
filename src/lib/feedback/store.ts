/**
 * Every preview and every filing, per person: the limits count here, and a
 * preview is filed at most once (the row is keyed on the preview's hash).
 *
 * status: previewed → filing → filed | labels_failed (filed, the labels not
 * added) | failed (GitHub refused; the same preview may be filed again).
 */

export type SubmissionStatus = 'previewed' | 'filing' | 'filed' | 'labels_failed' | 'failed'

export interface SubmissionRecord {
  previewHash: string
  profileId: string
  credentialId: string | null
  repo: string
  mode: 'issue' | 'comment'
  issueNumber: number | null
  commentId: number | null
  title: string | null
  labels: string[]
  target: string
  kind: string
  surface: string
  status: SubmissionStatus
  error: string | null
  createdAt: Date
  filedAt: Date | null
  updatedAt: Date
}

export type NewPreview = Pick<
  SubmissionRecord,
  'previewHash' | 'profileId' | 'credentialId' | 'repo' | 'mode' | 'issueNumber' | 'title' | 'labels' | 'target' | 'kind' | 'surface'
>

export type Claim = { state: 'claimed' } | { state: 'done'; record: SubmissionRecord } | { state: 'busy' }

export interface FinishPatch {
  status: SubmissionStatus
  issueNumber?: number | null
  commentId?: number | null
  error?: string | null
  filedAt?: Date | null
}

export interface FeedbackStore {
  countPreviewsSince(profileId: string, since: Date): Promise<number>
  countFiledSince(profileId: string, since: Date): Promise<number>
  /** Keep a preview; the same preview again changes nothing. */
  recordPreview(row: NewPreview, now: Date): Promise<void>
  /** Take the right to file this preview, or learn it was filed, or that another call is filing it. */
  claim(row: NewPreview, now: Date): Promise<Claim>
  finish(previewHash: string, patch: FinishPatch, now: Date): Promise<void>
}

/** A claim older than this with no outcome was a call that died; it may be taken again. */
export const STALE_FILING_MS = 2 * 60 * 1000

export const FILED: SubmissionStatus[] = ['filed', 'labels_failed']

export function memoryFeedbackStore(): FeedbackStore & { rows: Map<string, SubmissionRecord> } {
  const rows = new Map<string, SubmissionRecord>()
  const blank = (row: NewPreview, now: Date, status: SubmissionStatus): SubmissionRecord => ({
    ...row,
    commentId: null,
    status,
    error: null,
    createdAt: now,
    filedAt: null,
    updatedAt: now,
  })
  return {
    rows,
    async countPreviewsSince(profileId, since) {
      return Array.from(rows.values()).filter((r) => r.profileId === profileId && r.createdAt >= since).length
    },
    async countFiledSince(profileId, since) {
      return Array.from(rows.values()).filter((r) => r.profileId === profileId && FILED.includes(r.status) && r.filedAt && r.filedAt >= since)
        .length
    },
    async recordPreview(row, now) {
      if (!rows.has(row.previewHash)) rows.set(row.previewHash, blank(row, now, 'previewed'))
    },
    async claim(row, now) {
      const existing = rows.get(row.previewHash)
      if (!existing) {
        rows.set(row.previewHash, blank(row, now, 'filing'))
        return { state: 'claimed' }
      }
      if (FILED.includes(existing.status)) return { state: 'done', record: existing }
      if (existing.status === 'filing' && now.getTime() - existing.updatedAt.getTime() < STALE_FILING_MS) return { state: 'busy' }
      existing.status = 'filing'
      existing.updatedAt = now
      return { state: 'claimed' }
    },
    async finish(previewHash, patch, now) {
      const r = rows.get(previewHash)
      if (!r) return
      Object.assign(r, { ...patch, updatedAt: now })
    },
  }
}
