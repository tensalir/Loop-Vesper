import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

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
 *   1. Grouping packets by `(cmfCode, primary productSlug)`. Packets
 *      with no cmfCode are excluded — they're too ambiguous to merge
 *      automatically and should be reviewed by hand.
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

  // We rely on the FIRST render's productSlug as the de-facto product
  // for a packet. Pull every packet with at least one render alongside
  // a tiny per-render projection so we can group accurately.
  const packets = await prisma.cmfPacket.findMany({
    where: { cmfCode: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: {
      renders: {
        select: { id: true, productSlug: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
        take: 1,
      },
    },
  })

  // Group: `${cmfCode}::${productSlug}` → packets[]  (oldest first via the orderBy above)
  const groups = new Map<string, typeof packets>()
  for (const p of packets) {
    if (!p.cmfCode) continue
    const productSlug = p.renders[0]?.productSlug
    if (!productSlug) continue
    const key = `${p.cmfCode.toLowerCase()}::${productSlug.toLowerCase()}`
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
        canonicalId: list[0].id,
        canonicalName: list[0].name,
        canonicalCreatedAt: list[0].createdAt,
        duplicateIds: list.slice(1).map((p) => p.id),
        duplicateNames: list.slice(1).map((p) => p.name),
      })),
      hint: 'POST again with ?apply=1 to perform the merge.',
    })
  }

  let mergedPackets = 0
  let mergedRenders = 0
  let mergedComments = 0
  let mergedActivity = 0
  let mergedMembers = 0
  const adminId = result.user.id

  for (const [, list] of duplicateGroups) {
    const canonical = list[0]
    const duplicates = list.slice(1)

    for (const dup of duplicates) {
      await prisma.$transaction(async (tx) => {
        // Re-point renders → canonical, bumping sortOrder past the
        // canonical's existing max so order stays deterministic.
        const maxSortOrder = await tx.cmfRender.aggregate({
          where: { packetId: canonical.id },
          _max: { sortOrder: true },
        })
        let nextSort = (maxSortOrder._max.sortOrder ?? -1) + 1
        const dupRenders = await tx.cmfRender.findMany({
          where: { packetId: dup.id },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        })
        for (const r of dupRenders) {
          await tx.cmfRender.update({
            where: { id: r.id },
            data: { packetId: canonical.id, sortOrder: nextSort++ },
          })
          mergedRenders++
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
    mergedComments,
    mergedActivity,
    mergedMembers,
    groupsProcessed: duplicateGroups.length,
  })
}
