import { webCheckPdf } from '@/lib/creative/cmf/web-door'

/** POST /api/cmf/v2/check-pdf: every value on a CMF PDF against its sheet cell (cmf_check_pdf's). */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export function POST(request: Request) {
  return webCheckPdf(request)
}
