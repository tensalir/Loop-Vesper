import { retired } from '@/lib/cmf/retired'

/**
 * POST /api/cmf/import: retired for CMF on 2026-09-30: every CMF step now goes through the CMF
 * service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says where each step went).
 * The old importer (src/lib/cmf/xlsx.ts) made packets from its own copy of the sheet. The step
 * answers 410 with one line naming the new one.
 */
export const dynamic = 'force-dynamic'

export function POST() {
  return retired('import')
}
