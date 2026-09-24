import { NextRequest, NextResponse } from 'next/server'
import { authenticateClient, presentedClient, resolveClient } from '@/lib/oauth/clients'
import { oauthConfig } from '@/lib/oauth/config'
import { CORS_HEADERS } from '@/lib/oauth/metadata'
import { oauthError, preflight, readForm } from '@/lib/oauth/http'
import { prismaOAuthStore } from '@/lib/oauth/store-prisma'
import { revokeToken } from '@/lib/oauth/tokens'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp/oauth/revoke — token revocation (RFC 7009).
 *
 * Revokes the token's whole family (the access and refresh tokens of one
 * sign-in). Answers 200 whether or not the token was known, so it cannot be
 * used to test tokens. Works while the sign-in is switched off: revoking must
 * always be possible.
 */
export async function POST(request: NextRequest) {
  const cfg = oauthConfig()
  const form = await readForm(request)
  const presented = presentedClient(request.headers.get('authorization'), form)
  let clientId: string | null = null
  if (presented !== 'malformed' && presented.clientId && cfg.secret) {
    const client = await resolveClient(presented.clientId, cfg)
    if (!client || !authenticateClient(client, presented, cfg.secret)) {
      return oauthError('invalid_client', 'Client authentication failed.', 401)
    }
    clientId = client.clientId
  }
  await revokeToken(prismaOAuthStore, form.get('token'), clientId, new Date())
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store', ...CORS_HEADERS } })
}

export async function OPTIONS() {
  return preflight()
}
