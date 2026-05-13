/**
 * Bulk-generate attempts across a packet.
 *
 *   POST /api/cmf/packets/[id]/generate
 *   body: { attemptsPerSku?: number, renderIds?: string[] }
 *
 * The endpoint streams nothing — it kicks off N attempt jobs per SKU and
 * returns a summary. The workspace polls /api/cmf/packets/[id] every few
 * seconds via React Query while attempts are in flight.
 *
 * Concurrency is capped so we never DoS Nano Banana from a single packet.
 * The skill recommends 3–5 attempts per SKU; default is 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { cmfError } from '@/lib/cmf/api'
import { CmfRenderError, runCmfRender } from '@/lib/cmf/render'
import { createRateLimiter } from '@/lib/api/rate-limit'
import pLimit from 'p-limit'

export const dynamic = 'force-dynamic'

const bulkLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 })

const BodySchema = z.object({
  attemptsPerSku: z.number().int().min(1).max(5).default(3).optional(),
  renderIds: z.array(z.string().uuid()).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const limited = bulkLimiter.check(auth.profile.userId)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }
  const parsed = BodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return cmfError('Invalid request body', {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  const attemptsPerSku = parsed.data.attemptsPerSku ?? 3

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    include: { renders: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!packet) return cmfError('Packet not found', { status: 404 })

  const targetRenders = parsed.data.renderIds
    ? packet.renders.filter((r) => parsed.data.renderIds!.includes(r.id))
    : packet.renders

  if (targetRenders.length === 0) {
    return NextResponse.json({
      summary: { sku: 0, attempts: 0, started: 0, failed: 0 },
      results: [],
    })
  }

  // Limit concurrency to keep model usage predictable. 2 in-flight jobs is
  // a safe sweet spot for Nano Banana Pro on a single packet.
  const limit = pLimit(2)
  const results: Array<{ renderId: string; attempt: number; ok: boolean; error?: string }> = []

  for (const render of targetRenders) {
    for (let i = 0; i < attemptsPerSku; i++) {
      results.push(await Promise.resolve({ renderId: render.id, attempt: i + 1, ok: false }))
    }
  }

  // Kick off all attempts. We wait for them all to settle before
  // responding so the UI knows how the burst went.
  await Promise.all(
    targetRenders.flatMap((render) =>
      Array.from({ length: attemptsPerSku }).map((_, i) =>
        limit(async () => {
          try {
            await runCmfRender({
              renderId: render.id,
              triggeredByUserId: auth.profile!.userId,
            })
            const slot = results.find(
              (r) => r.renderId === render.id && r.attempt === i + 1 && !r.ok && !r.error
            )
            if (slot) slot.ok = true
          } catch (err) {
            const message = err instanceof CmfRenderError ? err.message : err instanceof Error ? err.message : 'Render failed'
            const slot = results.find(
              (r) => r.renderId === render.id && r.attempt === i + 1 && !r.ok && !r.error
            )
            if (slot) {
              slot.ok = false
              slot.error = message
            }
          }
        })
      )
    )
  )

  const summary = {
    sku: targetRenders.length,
    attempts: results.length,
    started: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  }

  await logCmfActivity({
    packetId: params.id,
    userId: auth.profile.userId,
    action: 'rendered_sku',
    metadata: { mode: 'bulk', attemptsPerSku, ...summary },
  })

  return NextResponse.json({ summary, results })
}
