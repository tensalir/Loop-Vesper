import { NextRequest, NextResponse } from 'next/server'
import { MCP_TOOLS } from '@/lib/headless/mcp-tools'
import { MCP_PROMPTS } from '@/lib/headless/mcp-prompts'
import { MCP_RESOURCE_CATALOG } from '@/lib/headless/mcp-resources'
import { buildProtectedResourceMetadata } from '@/lib/headless/mcp-oauth'
import {
  handleMcpPost,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@/lib/headless/mcp-dispatch'

/**
 * POST /api/mcp
 *
 * Streamable HTTP MCP server (JSON-RPC 2.0) for Claude's MCP connector,
 * Cursor and any client that speaks MCP over HTTP. Authentication:
 * `Authorization: Bearer vsp_live_...`. The protocol handling and the tools
 * live in `src/lib/headless/mcp-dispatch.ts` and `src/lib/headless/tools/`.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  return handleMcpPost(request)
}

// Public capability probe, no auth: some MCP discovery flows check a server
// is reachable before authenticating.
export async function GET(request: NextRequest) {
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
          'Send `Authorization: Bearer vsp_live_...` on every POST request, or use `/api/mcp/<token>` for Claude custom connectors.',
        oauth: buildProtectedResourceMetadata(origin),
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
