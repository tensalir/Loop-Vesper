import { NextRequest } from 'next/server'
import { authenticateClient, presentedClient, resolveClient } from '@/lib/oauth/clients'
import { oauthConfig } from '@/lib/oauth/config'
import { oauthError, oauthJson, preflight, readForm, unavailable } from '@/lib/oauth/http'
import { prismaOAuthStore } from '@/lib/oauth/store-prisma'
import { exchangeCode, refreshGrant } from '@/lib/oauth/tokens'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp/oauth/token — codes for tokens, and refresh (RFC 6749 §3.2).
 *
 * Form-encoded. The client authenticates with its secret (basic or post) when
 * it registered with one; a public client is held by PKCE. Every refusal of
 * the grant itself is `invalid_grant` and says no more. Nothing is cached.
 */
export async function POST(request: NextRequest) {
  const cfg = oauthConfig()
  if (!cfg.enabled || !cfg.secret) return unavailable()
  const form = await readForm(request)
  const presented = presentedClient(request.headers.get('authorization'), form)
  if (presented === 'malformed' || !presented.clientId) {
    return oauthError('invalid_client', 'Client authentication failed.', 401)
  }
  const client = await resolveClient(presented.clientId, cfg)
  if (!client || !authenticateClient(client, presented, cfg.secret)) {
    return oauthError(
      'invalid_client',
      'Client authentication failed.',
      401,
      presented.via === 'basic' ? { 'WWW-Authenticate': 'Basic realm="vesper"' } : {}
    )
  }
  const now = new Date()
  const grant = form.get('grant_type')
  if (grant === 'authorization_code') {
    const result = await exchangeCode(prismaOAuthStore, {
      code: form.get('code'),
      codeVerifier: form.get('code_verifier'),
      redirectUri: form.get('redirect_uri'),
      clientId: client.clientId,
      resource: form.get('resource'),
      now,
    })
    return result.ok ? oauthJson(result.body) : oauthJson(result.body, result.status)
  }
  if (grant === 'refresh_token') {
    const result = await refreshGrant(prismaOAuthStore, {
      refreshToken: form.get('refresh_token'),
      clientId: client.clientId,
      now,
    })
    return result.ok ? oauthJson(result.body) : oauthJson(result.body, result.status)
  }
  return oauthError('unsupported_grant_type', 'Supported: authorization_code, refresh_token.')
}

export async function OPTIONS() {
  return preflight()
}
