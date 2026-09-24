import { NextRequest } from 'next/server'
import { registerClient } from '@/lib/oauth/clients'
import { oauthConfig } from '@/lib/oauth/config'
import { oauthJson, preflight, unavailable } from '@/lib/oauth/http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/mcp/oauth/register — dynamic client registration (RFC 7591).
 *
 * Stateless: the client id carries the registration, signed (src/lib/oauth/clients.ts).
 * Redirect URIs are limited to Claude's callbacks, loopback addresses and the
 * owner's allowlist; anything else is refused here and again at authorize.
 */
export async function POST(request: NextRequest) {
  const cfg = oauthConfig()
  if (!cfg.enabled) return unavailable()
  const body = await request.json().catch(() => null)
  const result = registerClient(body, cfg, Math.floor(Date.now() / 1000))
  return oauthJson(result.body, result.status)
}

export async function OPTIONS() {
  return preflight()
}
