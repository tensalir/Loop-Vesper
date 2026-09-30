import { webSupplierPdf } from '@/lib/creative/cmf/web-door'

/** POST /api/cmf/v2/pdf: the supplier PDF from one upload and approved renders (cmf_pdf's). */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export function POST(request: Request) {
  return webSupplierPdf(request)
}
