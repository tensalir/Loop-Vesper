/**
 * The feedback store in the database (`feedback_submissions`). Kept apart from
 * `store.ts` so the logic and its tests load without a database.
 */

import { prisma } from '@/lib/prisma'
import { FILED, STALE_FILING_MS, type FeedbackStore, type SubmissionRecord, type SubmissionStatus } from './store'

type Row = {
  previewHash: string
  profileId: string
  credentialId: string | null
  repo: string
  mode: string
  issueNumber: number | null
  commentId: bigint | null
  title: string | null
  labels: string[]
  target: string
  kind: string
  surface: string
  status: string
  error: string | null
  createdAt: Date
  filedAt: Date | null
  updatedAt: Date
}

function fromRow(r: Row): SubmissionRecord {
  return {
    ...r,
    mode: r.mode === 'comment' ? 'comment' : 'issue',
    commentId: r.commentId === null ? null : Number(r.commentId),
    status: r.status as SubmissionStatus,
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

export const prismaFeedbackStore: FeedbackStore = {
  async countPreviewsSince(profileId, since) {
    return prisma.feedbackSubmission.count({ where: { profileId, createdAt: { gte: since } } })
  },
  async countFiledSince(profileId, since) {
    return prisma.feedbackSubmission.count({ where: { profileId, status: { in: FILED }, filedAt: { gte: since } } })
  },
  async recordPreview(row, now) {
    try {
      await prisma.feedbackSubmission.create({ data: { ...row, status: 'previewed', createdAt: now } })
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  },
  async claim(row, now) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await prisma.feedbackSubmission.findUnique({ where: { previewHash: row.previewHash } })
      if (!existing) {
        try {
          await prisma.feedbackSubmission.create({ data: { ...row, status: 'filing', createdAt: now } })
          return { state: 'claimed' }
        } catch (err) {
          if (!isUniqueViolation(err)) throw err
          continue
        }
      }
      const record = fromRow(existing as Row)
      if (FILED.includes(record.status)) return { state: 'done', record }
      if (record.status === 'filing' && now.getTime() - record.updatedAt.getTime() < STALE_FILING_MS) return { state: 'busy' }
      const taken = await prisma.feedbackSubmission.updateMany({
        where: { previewHash: row.previewHash, status: record.status, updatedAt: record.updatedAt },
        data: { status: 'filing' },
      })
      return taken.count === 1 ? { state: 'claimed' } : { state: 'busy' }
    }
    return { state: 'busy' }
  },
  async finish(previewHash, patch) {
    await prisma.feedbackSubmission.update({
      where: { previewHash },
      data: {
        status: patch.status,
        ...(patch.issueNumber !== undefined ? { issueNumber: patch.issueNumber } : {}),
        ...(patch.commentId !== undefined ? { commentId: patch.commentId === null ? null : BigInt(patch.commentId) } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.filedAt !== undefined ? { filedAt: patch.filedAt } : {}),
      },
    })
  },
}
