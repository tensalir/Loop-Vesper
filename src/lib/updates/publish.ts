/**
 * DB publish layer for the Updates auto-pipeline.
 *
 * Responsibilities:
 *   - Decide whether a commit range has already been published (dedupe).
 *   - Generate a stable, human-readable slug for the entry.
 *   - Persist the `ProductUpdate` row with the right metadata.
 *
 * Dedupe model:
 *   The unique signal is the upper bound of the commit range (`commit_range_end`)
 *   — that's the newest commit included in the entry. If we ever see the same
 *   `commit_range_end` again we skip the publish. This avoids the "rerun the
 *   pipeline twice and get duplicate cards" failure mode without locking us
 *   into "exactly one entry per commit" (a single commit could legitimately
 *   anchor one entry and later a wider window).
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { GitCommitWithFiles } from './git'
import type { GeneratedUpdate } from './generator'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'update'
}

function dateSlug(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface PublishContext {
  cluster: GitCommitWithFiles[]
  generated: GeneratedUpdate
  significanceScore: number
  /** Whether this publish came from the 60-day backfill task. */
  backfill?: boolean
}

export interface PublishResult {
  status: 'created' | 'skipped-duplicate'
  id?: string
  slug?: string
}

/** Build a unique-ish slug. Collisions are still possible across two
 *  releases on the same day with the same title; fall back to appending the
 *  short SHA of the newest commit. */
function buildSlug(generated: GeneratedUpdate, cluster: GitCommitWithFiles[]): string {
  const newest = cluster[0]
  const baseDate = newest ? new Date(newest.date) : new Date()
  const base = `${dateSlug(baseDate)}-${slugify(generated.title)}`
  if (!newest) return base
  return `${base}-${newest.shortSha}`
}

export async function publishUpdate(ctx: PublishContext): Promise<PublishResult> {
  const newest = ctx.cluster[0]
  const oldest = ctx.cluster[ctx.cluster.length - 1]
  if (!newest || !oldest) {
    return { status: 'skipped-duplicate' }
  }

  // Dedupe: if any published entry already covers this `commit_range_end`,
  // skip. The historical backfill writes with `backfilled=true`; we still
  // dedupe across all rows so reruns are idempotent.
  const existing = await prisma.productUpdate.findFirst({
    where: { commitRangeEnd: newest.sha },
    select: { id: true, slug: true },
  })
  if (existing) {
    return { status: 'skipped-duplicate', id: existing.id, slug: existing.slug }
  }

  const slug = buildSlug(ctx.generated, ctx.cluster)
  const source = ctx.backfill
    ? 'backfill'
    : ctx.generated.source === 'fallback'
    ? 'auto'
    : 'auto'

  const data: Prisma.ProductUpdateCreateInput = {
    slug,
    title: ctx.generated.title,
    summary: ctx.generated.summary,
    snippets: ctx.generated.snippets as unknown as Prisma.JsonValue,
    publishedAt: new Date(newest.date),
    significanceScore: ctx.significanceScore,
    commitRangeStart: oldest.sha,
    commitRangeEnd: newest.sha,
    backfilled: !!ctx.backfill,
    source,
    isPublished: true,
  }

  const created = await prisma.productUpdate.create({ data })
  return { status: 'created', id: created.id, slug: created.slug }
}
