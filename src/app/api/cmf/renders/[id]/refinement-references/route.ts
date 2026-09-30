import { retired } from '@/lib/cmf/retired'

/**
 * POST /api/cmf/renders/{id}/refinement-references: retired for CMF on 2026-09-30: every CMF step
 * now goes through the CMF service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts
 * says where each step went). Reference images for a refinement are no longer sent: the clown is
 * the only image. The step answers 410 with one line naming the new one.
 */
export const dynamic = 'force-dynamic'

export function POST() {
  return retired('refine')
}
