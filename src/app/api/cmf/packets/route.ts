import { NextRequest, NextResponse } from 'next/server'
import { listAccessiblePackets, requireAuthenticatedProfile } from '@/lib/cmf/service'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/packets: GET lists the packets made the old way, read only (the CMF Studio's History
 * tab). POST, which made a packet from rows, is retired for CMF on 2026-09-30: every CMF step now
 * goes through the CMF service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says
 * where each step went). A retired method answers 410 with one line naming the new step.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const packets = await listAccessiblePackets(auth.profile.userId)
  return NextResponse.json({
    packets: packets.map((p) => ({
      id: p.id,
      name: p.name,
      cmfCode: p.cmfCode,
      status: p.status,
      pdfUrl: p.pdfUrl,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      generatedAt: p.generatedAt,
      renderCount: p.renders.length,
      renders: p.renders,
      role: p.role,
      isOwner: p.role === 'owner',
    })),
  })
}

export function POST() {
  return retired('packet')
}
