import { NextRequest, NextResponse } from 'next/server'
import { buildCmfTemplateWorkbook } from '@/lib/cmf/xlsx'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cmf/template
 *
 * Returns a starter .xlsx template for CMF imports. Authenticated callers
 * only — we don't surface this anonymously because the template encodes our
 * product slugs and component vocabulary.
 */
export async function GET(_request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const { searchParams } = new URL(_request.url)
  const productSlug = searchParams.get('productSlug') || 'switch2'

  const buffer = buildCmfTemplateWorkbook(productSlug)
  // Re-wrap as a fresh Uint8Array so the response body satisfies
  // BodyInit on every TypeScript lib target (Node Buffer extends
  // Uint8Array but isn't recognised as BodyInit in some checks).
  const body = new Uint8Array(buffer)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="cmf-template-${productSlug}.xlsx"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
}
