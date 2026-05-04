import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/api/auth'
import { revokeCredential } from '@/lib/headless/credentials'
import { prisma } from '@/lib/prisma'

/**
 * Admin-only revoke endpoint for a single headless credential.
 *
 * DELETE — soft-revoke (sets revokedAt, keeps audit trail).
 */

const RevokeBodySchema = z.object({
  reason: z.string().max(500).optional(),
})

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin()
  if (admin.response) return admin.response

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = RevokeBodySchema.safeParse(body)
  const reason = parsed.success ? parsed.data.reason : undefined

  const credential = await prisma.headlessCredential.findUnique({
    where: { id: params.id },
    select: { id: true, revokedAt: true },
  })
  if (!credential) {
    return NextResponse.json(
      { error: 'Credential not found' },
      { status: 404 }
    )
  }
  if (credential.revokedAt) {
    return NextResponse.json(
      { error: 'Credential is already revoked', revokedAt: credential.revokedAt },
      { status: 409 }
    )
  }

  await revokeCredential({
    credentialId: credential.id,
    reason,
  })

  return NextResponse.json({ ok: true, revokedAt: new Date().toISOString() })
}
