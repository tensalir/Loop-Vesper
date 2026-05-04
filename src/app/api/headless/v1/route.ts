import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/headless/v1
 *
 * Public discovery endpoint — no auth required. Returns the surface
 * version, supported tools, and pointers to authenticated routes. Lets
 * external clients (and Damien's MCP runtime) confirm they're hitting
 * a Vesper-compatible server before negotiating credentials.
 */
export async function GET(_request: NextRequest) {
  return NextResponse.json(
    {
      service: 'vesper-headless',
      version: 'v1',
      authentication: {
        scheme: 'Bearer',
        description:
          'Issue a credential via the admin UI. Send `Authorization: Bearer vsp_live_...` on every request.',
      },
      surfaces: {
        rest: '/api/headless/v1',
        mcp: '/api/mcp',
      },
      tools: [
        {
          name: 'enhance_prompt',
          description:
            'Enhance a single image or video prompt using the Vesper Gen-AI prompting skill.',
          rest: 'POST /api/headless/v1/prompts/enhance',
        },
        {
          name: 'iterate_prompt',
          description:
            'Produce an Andromeda-aware diversified prompt slate from a baseline concept.',
          rest: 'POST /api/headless/v1/prompts/iterate',
        },
        {
          name: 'list_models',
          description:
            'List the image and video models the calling credential is permitted to use.',
          rest: 'GET /api/headless/v1/models',
        },
      ],
      docs: '/docs/headless-vesper.md',
    },
    {
      headers: {
        // Cache discovery for a minute at the edge — the surface shape is stable.
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    }
  )
}
