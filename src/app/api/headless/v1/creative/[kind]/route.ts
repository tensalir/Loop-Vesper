import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHeadlessHandler } from '@/lib/headless/handler'
import { ExportArgs, exportRows } from '@/lib/headless/tools/creative-export'

/**
 * GET /api/headless/v1/creative/{grades|verdicts|manifests}?product=&since=&limit=
 *
 * What the plugin repository's nightly job reads back from Vesper: every
 * grade, every decider's answer, every product draw's manifest line, oldest
 * first from `since`; `next_since` pages forward. Needs a static credential
 * carrying the tool `export_creative_records`, issued by an admin for the
 * repository's GitHub Actions secret.
 */

export const dynamic = 'force-dynamic'

export const GET = withHeadlessHandler(
  {
    surface: 'rest',
    route: '/api/headless/v1/creative/[kind]',
    tool: 'export_creative_records',
    parseJsonBody: false,
  },
  async (ctx) => {
    const url = ctx.request.nextUrl
    const kind = url.pathname.split('/').filter(Boolean).pop()
    const limit = url.searchParams.get('limit')
    const parsed = ExportArgs.safeParse({
      kind,
      ...(url.searchParams.get('product') ? { product: url.searchParams.get('product') } : {}),
      ...(url.searchParams.get('since') ? { since: url.searchParams.get('since') } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
    })
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: 'Bad request', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      }
    }
    ctx.setMetadata({ kind: parsed.data.kind, product: parsed.data.product ?? null })
    return { body: await exportRows(parsed.data) }
  }
)

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: 'Method not allowed. Use GET.' }, { status: 405, headers: { Allow: 'GET' } })
}
