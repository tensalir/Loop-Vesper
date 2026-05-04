import type { NextRequest } from 'next/server'
import { handleMcpPost } from '../route'

/**
 * POST /api/mcp/[token]
 *
 * Token-in-URL variant of the MCP server. Exists because Claude's web
 * "Add custom connector" form has a single Remote MCP server URL field
 * and no header/auth field, so the only way to authenticate without
 * building OAuth is to encode the credential into the URL itself.
 *
 * Each Loop partner is emailed a unique URL like
 * `https://vesper.loop.dev/api/mcp/vsp_live_xxxx_yyyy`. The token is
 * pulled out of `params.token`, hashed, and looked up via the same
 * `HeadlessCredential` model that backs the bearer-header surface; rate
 * limits, tool allowlists, model allowlists, audit logs, and revocation
 * all behave identically.
 *
 * The bearer-header path at `/api/mcp` keeps working in parallel for
 * Cursor and direct API clients.
 */
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  // Tokens are URL-safe by construction (vsp_live_<hex>_<hex>) but
  // decode defensively in case a client URI-encodes the path segment.
  const decoded = decodeURIComponent(token ?? '')
  return handleMcpPost(request, { tokenFromPath: decoded })
}
