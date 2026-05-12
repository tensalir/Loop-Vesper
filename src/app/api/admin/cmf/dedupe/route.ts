import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { packetRowSignature } from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

/**
 * One-shot legacy dedupe for CMF packets.
 *
 *   POST /api/admin/cmf/dedupe          — dry-run report
 *   POST /api/admin/cmf/dedupe?apply=1  — actually merge duplicates
 *
 * Pre-2026-05-12 every workbook upload created a new packet, so
 * re-uploading "Aphrodite Carry Case" three times produced three
 * indistinguishable entries in the dropdown. Phase 2 of the smart-import
 * change merges by `(productSlug, cmfCode)` going forward; this endpoint
 * cleans up any pre-existing duplicates by:
 *
 *   1. Grouping packets two ways:
 *      a) By `(cmfCode, primary productSlug)` for packets that carry a
 *         CMF code — the precise key used by smart-merge going forward.
 *      b) By `(productSlug, SKU signature)` for null-cmfCode packets,
 *         where the signature is the sorted set of `productCode` (or
 *         normalised label) keys across the packet's renders. This
 *         catches the "designer iterates on the test workbook 8 times"
 *         pattern that has no CMF code to anchor on.
 *   2. Within each group, picking the OLDEST packet as the canonical
 *      record. Comments + members + activity already hang off that one
 *      so we minimise re-pointing churn.
 *   3. Re-pointing renders, comments, and activity from the younger
 *      packets onto the canonical, merging members (canonical wins
 *      when the same user is in both) and deleting the now-empty
 *      duplicates.
 *   4. Logging a `packet_merged` activity entry on the canonical so
 *      the timeline records the reconciliation.
 *
 * Idempotent: a second run finds no duplicates and reports a 0-change
 * summary. Admin-gated so a single accidental click doesn't mass-merge
 * production data.
 */
export async function POST(request: NextRequest) {
  const result = await requireAdmin()
  if (result.response) return result.response

  const apply = new URL(request.url).searchParams.get('apply') === '1'

  // Pull every packet with at least one render alongside a tiny
  // per-render projection so we can build both grouping keys. We need
  // ALL renders (not just the first) for the null-cmfCode signature
  // pass, hence no `take: 1` here.
  const packets = await prisma.cmfPacket.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      renders: {
        select: { id: true, productSlug: true, productCode: true, label: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  // Group two ways depending on whether the packet has a CMF code.
  // Bucket key embeds the strategy ("code::" vs "sig::") so dry-run
  // reports make it obvious which heuristic caught a given group.
  const groups = new Map<string, typeof packets>()
  for (const p of packets) {
    const productSlug = p.renders[0]?.productSlug
    if (!productSlug) continue
    let key: string
    if (p.cmfCode) {
      key = `code::${productSlug.toLowerCase()}::${p.cmfCode.toLowerCase()}`
    } else {
      const sig = packetRowSignature(
        p.renders.map((r) => ({ productCode: r.productCode, label: r.label }))
      )
      // Empty-signature packets (no labelled renders at all) are too
      // ambiguous to fold automatically; skip them.
      if (!sig) continue
      key = `sig::${productSlug.toLowerCase()}::${sig}`
    }
    const bucket = groups.get(key) ?? []
    bucket.push(p)
    groups.set(key, bucket)
  }

  const duplicateGroups = Array.from(groups.entries()).filter(([, list]) => list.length > 1)

  if (!apply) {
    // Dry-run: surface what WOULD be merged so an admin can sanity-check
    // before pulling the trigger.
    return NextResponse.json({
      dryRun: true,
      groupsFound: duplicateGroups.length,
      groups: duplicateGroups.map(([key, list]) => ({
        key,
        strategy: key.startsWith('code::') ? 'cmfCode' : 'skuSignature',
        canonicalId: list[0].id,
        canonicalName: list[0].name,
        canonicalCmfCode: list[0].cmfCode,
        canonicalCreatedAt: list[0].createdAt,
        duplicateIds: list.slice(1).map((p) => p.id),
        duplicateNames: list.slice(1).map((p) => p.name),
      })),
      hint: 'POST again with ?apply=1 to perform the merge.',
    })
  }

  let mergedPackets = 0
  let mergedRenders = 0
  let mergedRenderAttemptsMoved = 0
  let droppedDuplicateRenders = 0
  let mergedComments = 0
  let mergedActivity = 0
  let mergedMembers = 0
  const adminId = result.user.id

  // Same render-identity rule the smart-merge in `createPacketFromRows`
  // uses: prefer productCode, fall back to a normalised label key.
  function renderKey(r: { productCode: string | null; label: string }): string {
    return (r.productCode ?? r.label ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '')
  }

  for (const [, list] of duplicateGroups) {
    const canonical = list[0]
    const duplicates = list.slice(1)

    for (const dup of duplicates) {
      await prisma.$transaction(async (tx) => {
        // Build a key→render index for the canonical so we can decide,
        // per duplicate render, whether to MOVE it (new SKU) or
        // CONSOLIDATE it (same SKU as one already on the canonical —
        // its attempts move onto the canonical render and the
        // duplicate render row is deleted).
        const canonicalRenders = await tx.cmfRender.findMany({
          where: { packetId: canonical.id },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, productCode: true, label: true, sortOrder: true },
        })
        const canonicalByKey = new Map<string, (typeof canonicalRenders)[number]>()
        for (const r of canonicalRenders) {
          const k = renderKey(r)
          if (k && !canonicalByKey.has(k)) canonicalByKey.set(k, r)
        }
        let nextSort = canonicalRenders.reduce(
          (m, r) => Math.max(m, r.sortOrder + 1),
          0
        )

        const dupRenders = await tx.cmfRender.findMany({
          where: { packetId: dup.id },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, productCode: true, label: true },
        })
        for (const r of dupRenders) {
          const k = renderKey(r)
          const sameSku = k ? canonicalByKey.get(k) : undefined
          if (sameSku) {
            // Same SKU already on the canonical — re-point this
            // render's attempts onto the canonical render, then drop
            // the duplicate render row. Comments + activity that
            // pointed at the duplicate render get re-pointed too so
            // discussion history survives.
            const canonicalAttempts = await tx.cmfRenderAttempt.findMany({
              where: { renderId: sameSku.id },
              select: { attemptNumber: true },
              orderBy: { attemptNumber: 'desc' },
              take: 1,
            })
            let nextAttempt =
              (canonicalAttempts[0]?.attemptNumber ?? 0) + 1
            const dupAttempts = await tx.cmfRenderAttempt.findMany({
              where: { renderId: r.id },
              select: { id: true },
              orderBy: { attemptNumber: 'asc' },
            })
            for (const a of dupAttempts) {
              await tx.cmfRenderAttempt.update({
                where: { id: a.id },
                data: { renderId: sameSku.id, attemptNumber: nextAttempt++ },
              })
              mergedRenderAttemptsMoved++
            }
            await tx.cmfComment.updateMany({
              where: { renderId: r.id },
              data: { renderId: sameSku.id },
            })
            await tx.cmfActivity.updateMany({
              where: { packetId: dup.id, targetId: r.id },
              data: { targetId: sameSku.id },
            })
            await tx.cmfRender.delete({ where: { id: r.id } })
            droppedDuplicateRenders++
          } else {
            // Net-new SKU — move it onto the canonical packet,
            // appending past the existing sortOrder. Add to the index
            // so a subsequent duplicate render with the same key
            // consolidates onto THIS one rather than being moved
            // again.
            const moved = await tx.cmfRender.update({
              where: { id: r.id },
              data: { packetId: canonical.id, sortOrder: nextSort++ },
              select: { id: true, productCode: true, label: true, sortOrder: true },
            })
            mergedRenders++
            if (k) canonicalByKey.set(k, moved)
          }
        }

        // Re-point comments + activity onto the canonical packet.
        const cmt = await tx.cmfComment.updateMany({
          where: { packetId: dup.id },
          data: { packetId: canonical.id },
        })
        mergedComments += cmt.count
        const act = await tx.cmfActivity.updateMany({
          where: { packetId: dup.id },
          data: { packetId: canonical.id },
        })
        mergedActivity += act.count

        // Merge members — keep the canonical's role when both packets
        // list the same user; copy-over otherwise.
        const dupMembers = await tx.cmfPacketMember.findMany({
          where: { packetId: dup.id },
        })
        for (const m of dupMembers) {
          const existing = await tx.cmfPacketMember.findUnique({
            where: { packetId_userId: { packetId: canonical.id, userId: m.userId } },
          })
          if (!existing) {
            await tx.cmfPacketMember.create({
              data: {
                packetId: canonical.id,
                userId: m.userId,
                role: m.role,
                invitedBy: m.invitedBy,
                invitedAt: m.invitedAt,
                acceptedAt: m.acceptedAt,
              },
            })
            mergedMembers++
          }
          await tx.cmfPacketMember.delete({
            where: { packetId_userId: { packetId: dup.id, userId: m.userId } },
          })
        }

        // Delete the now-empty duplicate. Cascades clean up any leftover
        // FK rows we didn't migrate (there shouldn't be any).
        await tx.cmfPacket.delete({ where: { id: dup.id } })
        mergedPackets++

        await tx.cmfActivity.create({
          data: {
            packetId: canonical.id,
            userId: adminId,
            action: 'packet_merged',
            metadata: {
              source: 'admin_dedupe',
              mergedFromPacketId: dup.id,
              mergedFromName: dup.name,
            },
          },
        })
      })
    }
  }

  return NextResponse.json({
    dryRun: false,
    mergedPackets,
    mergedRenders,
    mergedRenderAttemptsMoved,
    droppedDuplicateRenders,
    mergedComments,
    mergedActivity,
    mergedMembers,
    groupsProcessed: duplicateGroups.length,
  })
}
