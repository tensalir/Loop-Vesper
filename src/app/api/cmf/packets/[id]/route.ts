import { NextRequest, NextResponse } from 'next/server'
import { CmfNotFoundError, findAccessiblePacket, requireAuthenticatedProfile, requirePacketAccess } from '@/lib/cmf/service'
import { translateAccessError } from '@/lib/cmf/api'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/packets/{id}: GET reads a packet made the old way, with its SKUs and attempts, read
 * only. PATCH (names, notes, the PDF layout draft) and DELETE is retired for CMF on 2026-09-30:
 * every CMF step now goes through the CMF service at /api/cmf/v2, as Claude's tools do
 * (src/lib/cmf/retired.ts says where each step went). A retired method answers 410 with one line
 * naming the new step.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    // Any role can read; viewers see exactly the same data shape.
    await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
    })
    const packet = await findAccessiblePacket(params.id, auth.profile.userId)
    if (!packet) throw new CmfNotFoundError()
    return NextResponse.json({ packet })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }
}

export function PATCH() {
  return retired('history')
}

export function DELETE() {
  return retired('history')
}
