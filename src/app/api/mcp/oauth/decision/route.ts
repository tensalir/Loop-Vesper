import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { oauthConfig } from '@/lib/oauth/config'
import { htmlPage } from '@/lib/oauth/http'
import { clientKeyFor } from '@/lib/oauth/redirects'
import { codeRedirect, errorRedirect, verifyAuthRequest } from '@/lib/oauth/request'
import { prismaOAuthStore } from '@/lib/oauth/store-prisma'
import { issueCode } from '@/lib/oauth/tokens'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp/oauth/decision — the person's answer on `/connect`.
 *
 * A same-site form post: the Origin (or Referer) must be this site, the
 * Supabase session must be the person's, and the signed request must be
 * unexpired. Allow finds or creates the person's one credential for this
 * client (`kind = 'oauth'`, every tool their flags allow, every model),
 * issues a five-minute code and sends the browser back to the client. Deny
 * sends it back with `access_denied`. The browser follows a 303 with a GET.
 */
function sameSite(request: NextRequest, origin: string): boolean {
  const from = request.headers.get('origin') || request.headers.get('referer')
  if (!from) return false
  try {
    return new URL(from).origin === origin
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const origin = new URL(request.url).origin
  const cfg = oauthConfig()
  if (!cfg.enabled) {
    return htmlPage(503, 'Sign-in is off', 'Connecting Claude to Vesper is switched off right now.')
  }
  if (!sameSite(request, origin)) {
    return htmlPage(403, 'This sign-in cannot continue', 'The answer did not come from the Vesper page. Start again from Claude.')
  }
  const form = await request.formData().catch(() => null)
  const areq = form?.get('areq')
  const now = new Date()
  const req = verifyAuthRequest(areq, cfg.secret, Math.floor(now.getTime() / 1000))
  if (!req) {
    return htmlPage(
      400,
      'This sign-in expired',
      'Ten minutes passed, or the link was changed. Go back to Claude and click Connect again.'
    )
  }
  if (form?.get('decision') !== 'allow') {
    return NextResponse.redirect(
      errorRedirect(req.redirectUri, origin, 'access_denied', 'The person declined.', req.state),
      303
    )
  }
  const { user } = await getAuthUser()
  if (!user) {
    const back = new URL('/login', origin)
    back.searchParams.set('next', `/connect?areq=${encodeURIComponent(String(areq))}`)
    return NextResponse.redirect(back.toString(), 303)
  }
  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { id: true, role: true, mcpAccess: true, pausedAt: true, deletedAt: true },
  })
  if (!profile || profile.deletedAt || profile.pausedAt || (!profile.mcpAccess && profile.role !== 'admin')) {
    return NextResponse.redirect(
      errorRedirect(
        req.redirectUri,
        origin,
        'access_denied',
        'Claude access is not turned on for this Vesper account.',
        req.state
      ),
      303
    )
  }
  const credential = await prismaOAuthStore.upsertCredential({
    ownerId: profile.id,
    clientKey: clientKeyFor(req.redirectUri),
    clientId: req.clientId,
    clientName: req.clientName,
    subjectEmail: user.email ?? null,
  })
  const code = await issueCode(prismaOAuthStore, {
    request: req,
    profileId: profile.id,
    credentialId: credential.id,
    now,
  })
  return NextResponse.redirect(codeRedirect(req.redirectUri, origin, code, req.state), 303)
}
