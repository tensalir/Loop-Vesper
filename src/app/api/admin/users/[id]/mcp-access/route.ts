import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { decideClaudeAccess, prismaClaudeAccessStore } from '@/lib/oauth/claude-access'

/**
 * PATCH /api/admin/users/:id/mcp-access
 *
 * An admin's decision on whether a person may connect Claude (or another MCP client) to Vesper
 * with their own sign-in. Body: `{ "enabled": true | false }`. Admin-only.
 *
 * The decision is recorded with who made it and when (`mcp_access_decided_at`, `_by`) and always
 * wins: Loop accounts get Claude access automatically on their first connect, but never once an
 * admin has decided, so turning someone off keeps them off.
 *
 * Turning it off takes effect on the person's next request: every OAuth access token is checked
 * against the flag on each call, so no revocation is needed. Admins pass without the flag. Static
 * tokens from /headless are governed by `headlessAccess`, not by this flag.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await requireAdmin()
    if (result.response) return result.response

    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid body. Expected `{ "enabled": boolean }`.' }, { status: 400 })
    }

    const decided = await decideClaudeAccess(prismaClaudeAccessStore, {
      profileId: id,
      enabled: body.enabled,
      adminId: result.user.id,
      now: new Date(),
    })
    if (!decided.ok) return NextResponse.json({ error: decided.error }, { status: decided.status })
    return NextResponse.json(decided.profile)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update Claude access'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
