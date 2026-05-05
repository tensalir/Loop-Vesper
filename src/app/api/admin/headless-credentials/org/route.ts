import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { issueCredential } from '@/lib/headless/credentials'
import type { HeadlessTool } from '@/lib/headless/auth'

/**
 * Admin-only shortcut for issuing an org-shared headless credential.
 *
 * Wraps the generic /api/admin/headless-credentials POST with sensible
 * defaults for the Claude Teams/Enterprise install path:
 *
 *   - Higher rate limits than a per-user credential, since N teammates
 *     hit the same token concurrently.
 *   - Wildcard model access (the org-shared connector is meant to
 *     expose every model Loop offers; per-user scoping happens later).
 *   - All three MCP tools enabled.
 *   - Sensible default name so the credential is easy to spot in the
 *     admin list.
 *
 * The response includes the full ready-to-paste connector URL using the
 * same host-resolution chain as the self-service endpoint:
 *
 *   NEXT_PUBLIC_APP_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL >
 *   the incoming request origin
 *
 * so the admin never has to hand-construct the URL.
 */

export const dynamic = 'force-dynamic'

const ORG_DEFAULTS = {
  allowedTools: [
    'enhance_prompt',
    'iterate_prompt',
    'list_models',
    'generate_asset',
    'list_product_renders',
  ] as HeadlessTool[],
  allowedModels: ['*'],
  rateLimitPerMinute: 200,
  rateLimitPerDay: 20_000,
  name: 'Loop Claude Enterprise Org',
}

const IssueOrgCredentialSchema = z.object({
  /** Optional override for the human-readable label. Defaults to a
   *  descriptive "Loop Claude Enterprise Org" when omitted. */
  name: z.string().min(1).max(120).optional(),
  /** Optional owner override. Defaults to the calling admin's profile
   *  so the credential lives under a real, active account. */
  ownerId: z.string().uuid('ownerId must be a valid Profile UUID').optional(),
  /** Optional rate-limit overrides. Both default to the org-friendly
   *  values above. */
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
  rateLimitPerDay: z.number().int().min(1).max(1_000_000).optional(),
})

function resolveOrigin(request: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercelProd) return `https://${vercelProd}`
  const vercelDeploy = process.env.VERCEL_URL?.trim()
  if (vercelDeploy) return `https://${vercelDeploy}`
  return new URL(request.url).origin
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (admin.response) return admin.response

  let body: unknown = {}
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = IssueOrgCredentialSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    )
  }

  const ownerId = parsed.data.ownerId ?? admin.user.id
  const owner = await prisma.profile.findUnique({
    where: { id: ownerId },
    select: { id: true, deletedAt: true, pausedAt: true },
  })
  if (!owner) {
    return NextResponse.json({ error: 'Owner profile not found' }, { status: 404 })
  }
  if (owner.deletedAt || owner.pausedAt) {
    return NextResponse.json(
      { error: 'Cannot issue a credential to a paused or deleted owner' },
      { status: 422 }
    )
  }

  const result = await issueCredential({
    ownerId,
    name: parsed.data.name ?? ORG_DEFAULTS.name,
    allowedTools: ORG_DEFAULTS.allowedTools,
    allowedModels: ORG_DEFAULTS.allowedModels,
    rateLimitPerMinute:
      parsed.data.rateLimitPerMinute ?? ORG_DEFAULTS.rateLimitPerMinute,
    rateLimitPerDay:
      parsed.data.rateLimitPerDay ?? ORG_DEFAULTS.rateLimitPerDay,
  })

  const url = `${resolveOrigin(request)}/api/mcp/${result.rawToken}`

  return NextResponse.json(
    {
      // Plaintext token, returned exactly once.
      rawToken: result.rawToken,
      // Pre-built ready-to-paste URL. Hand this to the Loop Claude
      // Enterprise Org Owner; they paste it under
      // https://claude.ai/admin-settings/connectors -> Add -> Custom -> Web.
      url,
      credential: result.credential,
      message:
        'Save the URL now. The token is part of it and we will not show it again. Hand the URL to your Loop Claude Org Owner — they paste it under Org settings -> Connectors -> Add -> Custom -> Web.',
      installInstructions: {
        ownerSteps: [
          'Open https://claude.ai/admin-settings/connectors',
          'Click Add',
          'Hover over Custom, then click Web',
          'Paste the URL above into Remote MCP server URL',
          'Leave Advanced settings empty',
          'Click Add',
        ],
        memberSteps: [
          'Open https://claude.ai/customize/connectors',
          'Find the connector tagged Custom called Vesper',
          'Click Connect',
        ],
      },
    },
    { status: 201 }
  )
}
