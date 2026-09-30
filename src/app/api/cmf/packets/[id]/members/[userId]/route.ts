import { retired } from '@/lib/cmf/retired'

/**
 * PATCH, DELETE /api/cmf/packets/{id}/members/{userId}: retired for CMF on 2026-09-30: every CMF
 * step now goes through the CMF service at /api/cmf/v2, as Claude's tools do
 * (src/lib/cmf/retired.ts says where each step went). Members belong to packets made the old way,
 * which are read only. The step answers 410 with one line naming the new one.
 */
export const dynamic = 'force-dynamic'

export function PATCH() {
  return retired('history')
}

export function DELETE() {
  return retired('history')
}
