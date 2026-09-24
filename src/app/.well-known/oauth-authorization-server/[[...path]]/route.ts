import { NextRequest, NextResponse } from 'next/server'
import { oauthConfig } from '@/lib/oauth/config'
import { authorizationServerMetadata, CORS_HEADERS } from '@/lib/oauth/metadata'

export const dynamic = 'force-dynamic'

/**
 * RFC 8414 authorization-server metadata. The issuer is the site's origin, so
 * the document is at `/.well-known/oauth-authorization-server`; the
 * path-suffixed forms some clients try answer the same.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  return NextResponse.json(authorizationServerMetadata(origin, oauthConfig()), {
    headers: { 'Cache-Control': 'public, max-age=300', ...CORS_HEADERS },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
