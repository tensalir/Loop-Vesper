import { NextRequest, NextResponse } from 'next/server'
import { CORS_HEADERS, protectedResourceMetadata } from '@/lib/oauth/metadata'

export const dynamic = 'force-dynamic'

/**
 * RFC 9728 protected-resource metadata, at `/.well-known/oauth-protected-resource`
 * and at the path-suffixed form `/.well-known/oauth-protected-resource/api/mcp`
 * that the 401 challenge of `/api/mcp` names. It tells a client which
 * authorization server issues tokens for `<origin>/api/mcp`: this site.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin
  return NextResponse.json(protectedResourceMetadata(origin), {
    headers: { 'Cache-Control': 'public, max-age=300', ...CORS_HEADERS },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
