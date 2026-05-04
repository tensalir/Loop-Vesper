import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { issueCredential } from '@/lib/headless/credentials'
import type { HeadlessTool } from '@/lib/headless/auth'

/**
 * Self-service MCP credential management for the /headless landing page.
 *
 * One active "self-issued" credential per user, distinguished from
 * admin-issued credentials by the literal `name`. The page never
 * surfaces or touches admin-issued credentials with other names.
 *
 * Authentication: Supabase user must exist AND profile must satisfy
 * `role === 'admin' || headlessAccess === true`. This mirrors the gate
 * on the page itself.
 *
 * Surfaces:
 *   GET    -> { status: 'none' } | { status: 'active', credential: {...} }
 *   POST   -> { rawToken, url, credential } - revoke any existing
 *             self-issued credential and issue a fresh one. Plaintext is
 *             returned exactly once.
 *   DELETE -> { ok: true } - revoke the self-issued credential without
 *             replacing it.
 */

export const dynamic = 'force-dynamic'

const SELF_ISSUED_NAME = 'Self-issued (vesper-headless)'
const SELF_ISSUED_TOOLS: HeadlessTool[] = [
  'enhance_prompt',
  'iterate_prompt',
  'list_models',
]
// `*` = wildcard access to every model the registry exposes. Self-service
// users get the full set; admins can issue narrower credentials via the
// admin endpoint if they want to scope a specific partner.
const SELF_ISSUED_MODELS = ['*']

interface AccessCheckOk {
  ok: true
  userId: string
}

interface AccessCheckFail {
  ok: false
  response: NextResponse
}

type AccessCheck = AccessCheckOk | AccessCheckFail

/**
 * Confirm the calling Supabase user is allowed to manage their own
 * headless credential. Same gate as the /headless page.
 */
async function requireHeadlessUser(): Promise<AccessCheck> {
  const { user, error, statusCode } = await getAuthUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: error || 'Unauthorized' },
        { status: statusCode || 401 }
      ),
    }
  }

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { role: true, headlessAccess: true },
  })
  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      ),
    }
  }

  const allowed = profile.role === 'admin' || profile.headlessAccess === true
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Headless access has not been granted to this account.' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, userId: user.id }
}

/**
 * Build the partner-facing MCP URL from the incoming request origin so
 * the value always matches the live host (localhost in dev, the Vercel
 * domain in prod) without needing an env var.
 */
function buildMcpUrl(request: NextRequest, rawToken: string): string {
  const origin = new URL(request.url).origin
  return `${origin}/api/mcp/${rawToken}`
}

export async function GET(_request: NextRequest) {
  const access = await requireHeadlessUser()
  if (!access.ok) return access.response

  const credential = await prisma.headlessCredential.findFirst({
    where: {
      ownerId: access.userId,
      name: SELF_ISSUED_NAME,
      revokedAt: null,
    },
    select: {
      id: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!credential) {
    return NextResponse.json({ status: 'none' })
  }

  return NextResponse.json({
    status: 'active',
    credential: {
      tokenPrefix: credential.tokenPrefix,
      createdAt: credential.createdAt.toISOString(),
      lastUsedAt: credential.lastUsedAt
        ? credential.lastUsedAt.toISOString()
        : null,
    },
  })
}

export async function POST(request: NextRequest) {
  const access = await requireHeadlessUser()
  if (!access.ok) return access.response

  // Atomically revoke any existing self-issued credential for this user
  // before issuing a fresh one. updateMany is safe to call even if there
  // is no match.
  await prisma.headlessCredential.updateMany({
    where: {
      ownerId: access.userId,
      name: SELF_ISSUED_NAME,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: 'replaced by self-service regenerate',
    },
  })

  const issued = await issueCredential({
    ownerId: access.userId,
    name: SELF_ISSUED_NAME,
    allowedTools: SELF_ISSUED_TOOLS,
    allowedModels: SELF_ISSUED_MODELS,
  })

  return NextResponse.json(
    {
      // Plaintext token is returned exactly once. The browser keeps it in
      // component state until the user navigates away or refreshes.
      rawToken: issued.rawToken,
      url: buildMcpUrl(request, issued.rawToken),
      credential: {
        tokenPrefix: issued.credential.tokenPrefix,
        createdAt: issued.credential.createdAt.toISOString(),
      },
    },
    { status: 201 }
  )
}

export async function DELETE(_request: NextRequest) {
  const access = await requireHeadlessUser()
  if (!access.ok) return access.response

  const result = await prisma.headlessCredential.updateMany({
    where: {
      ownerId: access.userId,
      name: SELF_ISSUED_NAME,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: 'self-service revoke',
    },
  })

  return NextResponse.json({ ok: true, revoked: result.count })
}
