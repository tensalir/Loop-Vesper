import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { issueCredential } from '@/lib/headless/credentials'
import type { HeadlessTool } from '@/lib/headless/auth'

/**
 * Admin-only management of headless Vesper credentials.
 *
 * GET  — list all credentials with non-secret metadata.
 * POST — issue a new credential. Returns the plaintext token EXACTLY ONCE.
 *        Subsequent reads return only the prefix.
 */

const TOOL_VALUES: HeadlessTool[] = [
  'enhance_prompt',
  'iterate_prompt',
  'list_models',
  'generate_asset',
]

const IssueCredentialSchema = z.object({
  ownerId: z.string().uuid('ownerId must be a valid Profile UUID'),
  name: z.string().min(1).max(120),
  allowedTools: z.array(z.enum(TOOL_VALUES as [HeadlessTool, ...HeadlessTool[]])).min(1),
  // Pass `['*']` for full access; an empty array means "no model access".
  allowedModels: z.array(z.string().max(128)).max(128).optional().default([]),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).optional(),
  rateLimitPerDay: z.number().int().min(1).max(1_000_000).optional(),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be an ISO-8601 timestamp' })
    .optional(),
})

export async function GET(_request: NextRequest) {
  const admin = await requireAdmin()
  if (admin.response) return admin.response

  const credentials = await prisma.headlessCredential.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      ownerId: true,
      name: true,
      tokenPrefix: true,
      allowedTools: true,
      allowedModels: true,
      rateLimitPerMinute: true,
      rateLimitPerDay: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      revokedReason: true,
      createdAt: true,
      owner: {
        select: { id: true, displayName: true, username: true },
      },
    },
  })

  return NextResponse.json({ credentials, total: credentials.length })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (admin.response) return admin.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = IssueCredentialSchema.safeParse(body)
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

  // Sanity-check the owner exists and isn't deleted/paused.
  const owner = await prisma.profile.findUnique({
    where: { id: parsed.data.ownerId },
    select: { id: true, deletedAt: true, pausedAt: true },
  })
  if (!owner) {
    return NextResponse.json(
      { error: 'Owner profile not found' },
      { status: 404 }
    )
  }
  if (owner.deletedAt || owner.pausedAt) {
    return NextResponse.json(
      { error: 'Cannot issue a credential to a paused or deleted owner' },
      { status: 422 }
    )
  }

  const result = await issueCredential({
    ownerId: parsed.data.ownerId,
    name: parsed.data.name,
    allowedTools: parsed.data.allowedTools,
    allowedModels: parsed.data.allowedModels ?? [],
    rateLimitPerMinute: parsed.data.rateLimitPerMinute,
    rateLimitPerDay: parsed.data.rateLimitPerDay,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
  })

  return NextResponse.json(
    {
      // The plaintext token is returned exactly once. Subsequent GETs only
      // return the prefix and metadata — there is no way to recover this
      // value if the operator loses it.
      rawToken: result.rawToken,
      credential: result.credential,
      message:
        'Save this token now. It will never be shown again. Provide it to the integrator as `Authorization: Bearer <token>`.',
    },
    { status: 201 }
  )
}
