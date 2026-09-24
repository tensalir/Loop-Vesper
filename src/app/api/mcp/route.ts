import { NextRequest, NextResponse } from 'next/server'
import { MCP_TOOLS } from '@/lib/headless/mcp-tools'
import { MCP_PROMPTS } from '@/lib/headless/mcp-prompts'
import { MCP_RESOURCE_CATALOG } from '@/lib/headless/mcp-resources'
import { protectedResourceMetadata } from '@/lib/oauth/metadata'
import {
  handleMcpPost,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@/lib/headless/mcp-dispatch'

/**
 * POST /api/mcp
 *
 * Streamable HTTP MCP server (JSON-RPC 2.0) for Claude's MCP connector,
 * Cursor and any client that speaks MCP over HTTP. Authentication: a
 * per-person sign-in (OAuth 2.1, `Authorization: Bearer vsp_oat_...`; a
 * tokenless request gets a 401 whose `WWW-Authenticate` names the
 * protected-resource document), or a static `Authorization: Bearer
 * vsp_live_...`. The protocol handling and the tools live in
 * `src/lib/headless/mcp-dispatch.ts` and `src/lib/headless/tools/`.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  return handleMcpPost(request, { challenge: true })
}

// Public capability probe, no auth: some MCP discovery flows check a server
// is reachable before authenticating. A client asking for a server-sent event
// stream is told there is none (405), as the streamable HTTP transport expects.
export async function GET(request: NextRequest) {
  if ((request.headers.get('accept') || '').includes('text/event-stream')) {
    return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
  }
  const origin = new URL(request.url).origin
  return NextResponse.json(
    {
      service: SERVER_INFO.name,
      version: SERVER_INFO.version,
      transport: 'streamable-http',
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      authentication: {
        scheme: 'Bearer',
        header: 'Authorization',
        description:
          'Add this URL to Claude as a custom connector and sign in with your Vesper login (OAuth 2.1). Scripts may send `Authorization: Bearer vsp_live_...` instead.',
        oauth: protectedResourceMetadata(origin),
      },
      methods: [
        'initialize',
        'notifications/initialized',
        'ping',
        'tools/list',
        'tools/call',
        'prompts/list',
        'prompts/get',
        'resources/list',
        'resources/read',
      ],
      tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title })),
      prompts: MCP_PROMPTS.map((p) => p.name),
      resources: MCP_RESOURCE_CATALOG.map((r) => r.uri),
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } }
  )
}
