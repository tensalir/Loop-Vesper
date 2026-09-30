import { retired } from '@/lib/cmf/retired'

/**
 * POST /api/cmf/renders/{id}/generate: retired for CMF on 2026-09-30: every CMF step now goes
 * through the CMF service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says where
 * each step went). An attempt drew from Vesper's own prompt, with refinement text and a clown that
 * could change. The step answers 410 with one line naming the new one.
 */
export const dynamic = 'force-dynamic'

export function POST() {
  return retired('render')
}
