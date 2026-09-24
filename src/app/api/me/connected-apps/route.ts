import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api/auth'
import { prismaOAuthStore } from '@/lib/oauth/store-prisma'

export const dynamic = 'force-dynamic'

/**
 * The apps a person connected to Vesper with their own sign-in (Claude, Claude
 * Code, a desktop client), shown in Settings under Connected apps.
 *
 *   GET              -> { apps: [{ id, name, clientName, clientKey, subjectEmail, createdAt, lastUsedAt }] }
 *   DELETE ?id=<id>  -> { ok: true }: the connection and every token it holds are revoked at once;
 *                       the app must sign in again to reach Vesper.
 *
 * Static tokens from /headless are not listed or touched here.
 */
export async function GET() {
  const { user, error, statusCode } = await getAuthUser()
  if (!user) return NextResponse.json({ error: error || 'Unauthorized' }, { status: statusCode ?? 401 })
  const apps = await prismaOAuthStore.listConnectedApps(user.id)
  return NextResponse.json({ apps })
}

export async function DELETE(request: NextRequest) {
  const { user, error, statusCode } = await getAuthUser()
  if (!user) return NextResponse.json({ error: error || 'Unauthorized' }, { status: statusCode ?? 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing ?id=' }, { status: 400 })
  const ok = await prismaOAuthStore.revokeCredential(user.id, id, new Date(), 'disconnected by its owner in Settings')
  if (!ok) return NextResponse.json({ error: 'No such connected app' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
