import { NextRequest, NextResponse } from 'next/server'
import { oauthConfig } from '@/lib/oauth/config'
import { htmlPage } from '@/lib/oauth/http'
import { signAuthRequest, validateAuthorize } from '@/lib/oauth/request'

export const dynamic = 'force-dynamic'

/**
 * GET /api/mcp/oauth/authorize — the start of the sign-in.
 *
 * A request whose client or redirect URI cannot be trusted stops on an error
 * page here and is never redirected. A request that is fine otherwise but
 * malformed goes back to the client with an error. A good request is signed
 * (ten minutes) and the browser goes to `/connect`, where the person signs in
 * to Vesper if needed and says yes or no.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const cfg = oauthConfig()
  const outcome = await validateAuthorize(url.searchParams, {
    origin: url.origin,
    cfg,
    nowSeconds: Math.floor(Date.now() / 1000),
  })
  if (outcome.kind === 'page') return htmlPage(outcome.status, outcome.title, outcome.message)
  if (outcome.kind === 'redirect') return NextResponse.redirect(outcome.location, 302)
  const connect = new URL('/connect', url.origin)
  connect.searchParams.set('areq', signAuthRequest(outcome.request, cfg.secret!))
  return NextResponse.redirect(connect.toString(), 302)
}
