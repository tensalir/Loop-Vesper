/**
 * Bidirectional projections with conflict policy.
 * - Projection A: Monday status/assignee/phase -> Figma (mirror as comment).
 * - Projection B: Figma feedback timeline -> Monday updates with version markers.
 * Authority: Monday = workflow/status; Figma = creative/localization.
 */

import { prisma } from '@/lib/prisma'
import { createItemUpdate } from '@/lib/monday/client'
import { postComment } from '@/lib/figma/client'

export interface ProjectionResult {
  linkId: string
  direction: 'figma_to_monday' | 'monday_to_figma'
  projected: number
  skipped: number
  errors: string[]
}

/**
 * Project Figma feedback events for a link to Monday (create updates on the item).
 * Only projects feedback from Figma (figma_creative authority).
 */
export async function projectFigmaFeedbackToMonday(linkId: string): Promise<ProjectionResult> {
  const result: ProjectionResult = {
    linkId,
    direction: 'figma_to_monday',
    projected: 0,
    skipped: 0,
    errors: [],
  }

  const link = await prisma.syncLink.findUnique({
    where: { id: linkId },
    select: { mondayItemId: true },
  })
  if (!link?.mondayItemId) {
    result.errors.push('Link has no mondayItemId')
    return result
  }

  const events = await prisma.syncEvent.findMany({
    where: { linkId, source: 'figma', kind: 'feedback' },
    orderBy: { occurredAt: 'asc' },
    select: { id: true, payload: true },
  })

  for (const ev of events) {
    const p = ev.payload as { content?: string; feedbackKind?: string; occurredAt?: string }
    const content = p?.content ?? ''
    if (!content && p?.feedbackKind !== 'resolve') continue
    const version = p?.occurredAt ?? ''
    const body = `[Figma] ${p?.feedbackKind === 'resolve' ? '(Resolved)' : content} | v ${version}`
    try {
      await createItemUpdate(link.mondayItemId, body)
      result.projected++
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : 'Create update failed')
      result.skipped++
    }
  }
  return result
}

/**
 * Project Monday workflow state for a link to Figma (post a status comment).
 * Only runs if link has figmaFileKey; posts one comment with latest Monday revision summary.
 */
export async function projectMondayStatusToFigma(linkId: string): Promise<ProjectionResult> {
  const result: ProjectionResult = {
    linkId,
    direction: 'monday_to_figma',
    projected: 0,
    skipped: 0,
    errors: [],
  }

  const link = await prisma.syncLink.findUnique({
    where: { id: linkId },
    select: { figmaFileKey: true, figmaNodeId: true },
  })
  if (!link?.figmaFileKey) {
    result.errors.push('Link has no figmaFileKey')
    return result
  }

  const latest = await prisma.syncRevision.findUnique({
    where: { linkId_source: { linkId, source: 'monday' } },
    select: { payload: true },
  })
  const payload = latest?.payload as Record<string, unknown> | undefined
  const summary =
    payload?.itemName != null
      ? `[Monday] ${String(payload.itemName)}`
      : '[Monday] Status synced'
  try {
    const comment = await postComment(link.figmaFileKey, summary, {
      nodeId: link.figmaNodeId ?? undefined,
    })
    if (comment) result.projected++
    else result.skipped++
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : 'Post comment failed')
    result.skipped++
  }
  return result
}

/**
 * Run both projections for a link. Respects authority: only project Figma->Monday for feedback,
 * and Monday->Figma for workflow summary.
 */
export async function runProjectionsForLink(linkId: string): Promise<ProjectionResult[]> {
  const results: ProjectionResult[] = []
  results.push(await projectFigmaFeedbackToMonday(linkId))
  results.push(await projectMondayStatusToFigma(linkId))
  return results
}

/**
 * Run Figma->Monday projection for all links that have both figma and monday ids.
 */
export async function runAllFigmaToMondayProjections(options?: {
  limit?: number
}): Promise<ProjectionResult[]> {
  const links = await prisma.syncLink.findMany({
    where: { mondayItemId: { not: null } },
    select: { id: true },
    take: options?.limit ?? 50,
  })
  const results: ProjectionResult[] = []
  for (const link of links) {
    results.push(await projectFigmaFeedbackToMonday(link.id))
  }
  return results
}
