import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/admin/users/:id/mcp-access
 *
 * Toggle whether a person may connect Claude (or another MCP client) to Vesper
 * with their own sign-in. Body: `{ "enabled": true | false }`. Admin-only.
 *
 * Turning it off takes effect on the person's next request: every OAuth access
 * token is checked against the flag on each call, so no revocation is needed.
 * Admins pass without the flag. Static tokens from /headless are governed by
 * `headlessAccess`, not by this flag.
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

    const profile = await prisma.profile.findUnique({ where: { id }, select: { id: true, deletedAt: true } })
    if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (profile.deletedAt) {
      return NextResponse.json({ error: 'Cannot grant access to a deleted user' }, { status: 400 })
    }

    const updated = await prisma.profile.update({
      where: { id },
      data: { mcpAccess: body.enabled },
      select: { id: true, mcpAccess: true },
    })
    return NextResponse.json(updated)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update Claude access'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
