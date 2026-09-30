import { retired } from '@/lib/cmf/retired'

/**
 * POST /api/admin/cmf/dedupe: retired for CMF on 2026-09-30. It merged duplicate packets made the
 * old way and deleted the emptied ones; those packets now stay as they are, read only, in the CMF
 * Studio's History tab, so nothing may merge or delete them. The step answers 410 with one line.
 */
export const dynamic = 'force-dynamic'

export function POST() {
  return retired('history')
}
