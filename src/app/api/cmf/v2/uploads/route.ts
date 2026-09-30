import { webUpload } from '@/lib/creative/cmf/web-door'

/**
 * POST /api/cmf/v2/uploads (multipart `file`): a workbook export kept for the CMF team, read by the
 * CMF engine's parse. Claude names it by the import id it answers with.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export function POST(request: Request) {
  return webUpload(request)
}
