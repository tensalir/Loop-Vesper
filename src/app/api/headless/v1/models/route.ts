import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHeadlessHandler } from '@/lib/headless/handler'
import { getAllModels } from '@/lib/models/registry'

/**
 * GET /api/headless/v1/models
 *
 * Returns the model catalog filtered to the credential's `allowedModels`
 * allowlist. We expose only what the calling token is permitted to use,
 * so a leak of one credential cannot enumerate the full provider stack.
 *
 * Empty `allowedModels` on a credential means "no model access" — the
 * token can still call discovery but the returned list is empty. To grant
 * universal access, an admin must set `allowedModels` to `['*']`.
 */

export const dynamic = 'force-dynamic'

export const GET = withHeadlessHandler(
  {
    surface: 'rest',
    route: '/api/headless/v1/models',
    tool: 'list_models',
  },
  async (ctx) => {
    const all = getAllModels().map((config) => ({
      id: config.id,
      name: config.name,
      provider: config.provider,
      type: config.type,
      description: config.description,
      capabilities: config.capabilities ?? {},
      supportedAspectRatios: config.supportedAspectRatios ?? [],
      defaultAspectRatio: config.defaultAspectRatio,
      maxResolution: config.maxResolution,
    }))

    const allowedModels = ctx.principal.allowedModels
    const wildcard = allowedModels.includes('*')
    const visible = wildcard
      ? all
      : all.filter((m) => allowedModels.includes(m.id))

    return {
      body: {
        models: visible,
        total: visible.length,
        wildcardAccess: wildcard,
      },
    }
  }
)

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Method not allowed. Use GET to list available models.' },
    { status: 405, headers: { Allow: 'GET' } }
  )
}
