/**
 * Higher-level CMF service helpers used by API routes.
 *
 * Access model:
 *   - Owner: the Profile that imported the workbook (`CmfPacket.ownerId`).
 *   - Members: rows in `cmf_packet_members` with one of three roles:
 *     viewer | editor | approver. Owner is implicit and acts as approver.
 *
 * Helpers in this module never trust a packet ID without an access check.
 * `requirePacketAccess` is the single chokepoint — every route that touches
 * a packet calls it, asks for a minimum role, and gets back a record of
 * what the caller can do plus the packet itself.
 */

import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { CmfSkuRow } from './schema'
import { getCmfProduct } from './products'

export class CmfNotFoundError extends Error {
  constructor(message = 'CMF resource not found') {
    super(message)
    this.name = 'CmfNotFoundError'
  }
}

export class CmfForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'CmfForbiddenError'
  }
}

export interface AuthenticatedProfile {
  userId: string
  email: string | null
}

export type CmfPacketRole = 'owner' | 'approver' | 'editor' | 'viewer'

const ROLE_RANK: Record<CmfPacketRole, number> = {
  viewer: 0,
  editor: 1,
  approver: 2,
  owner: 3,
}

export function roleAllows(actual: CmfPacketRole, required: CmfPacketRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

export async function requireAuthenticatedProfile(): Promise<
  | { profile: AuthenticatedProfile; response: null }
  | { profile: null; response: NextResponse }
> {
  const supabase = createRouteHandlerClient({ cookies })
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const profile = await prisma.profile.findUnique({
    where: { id: data.user.id },
    select: { deletedAt: true, pausedAt: true },
  })

  if (!profile || profile.deletedAt) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (profile.pausedAt) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Account paused' }, { status: 403 }),
    }
  }

  return {
    profile: { userId: data.user.id, email: data.user.email ?? null },
    response: null,
  }
}

/**
 * Resolve the calling user's role on a packet. Returns `null` when the user
 * has no relationship — callers should treat that as 404 (we don't leak
 * existence to non-members).
 */
export async function getPacketRole(
  packetId: string,
  userId: string
): Promise<CmfPacketRole | null> {
  const packet = await prisma.cmfPacket.findUnique({
    where: { id: packetId },
    select: { ownerId: true },
  })
  if (!packet) return null
  if (packet.ownerId === userId) return 'owner'

  const member = await prisma.cmfPacketMember.findUnique({
    where: { packetId_userId: { packetId, userId } },
    select: { role: true },
  })
  if (!member) return null
  if (member.role === 'approver' || member.role === 'editor' || member.role === 'viewer') {
    return member.role
  }
  return 'viewer'
}

/**
 * Single chokepoint for packet routes. Returns the role + packet, or throws
 * a typed error the route handler can translate to 404 (no access) or 403
 * (insufficient role).
 */
export async function requirePacketAccess(args: {
  packetId: string
  userId: string
  minRole?: CmfPacketRole
}) {
  const role = await getPacketRole(args.packetId, args.userId)
  if (!role) throw new CmfNotFoundError('Packet not found')
  if (args.minRole && !roleAllows(role, args.minRole)) {
    throw new CmfForbiddenError(
      `Role "${role}" cannot perform this action (requires ${args.minRole})`
    )
  }
  return { role }
}

export async function assertOwnsCmfPacket(packetId: string, ownerId: string) {
  const packet = await prisma.cmfPacket.findFirst({
    where: { id: packetId, ownerId },
    select: { id: true },
  })
  if (!packet) {
    throw new CmfNotFoundError('Packet not found')
  }
}

export async function assertOwnsCmfImport(importId: string, ownerId: string) {
  const record = await prisma.cmfImport.findFirst({
    where: { id: importId, ownerId },
    select: { id: true },
  })
  if (!record) {
    throw new CmfNotFoundError('Import not found')
  }
}

/**
 * Render-level access check — wraps `requirePacketAccess` with a render
 * lookup. Routes that mutate render rows (PATCH, generate) should require
 * editor or higher.
 */
export async function requireRenderAccess(args: {
  renderId: string
  userId: string
  minRole?: CmfPacketRole
}) {
  const render = await prisma.cmfRender.findUnique({
    where: { id: args.renderId },
    select: { packetId: true },
  })
  if (!render) throw new CmfNotFoundError('Render not found')
  const access = await requirePacketAccess({
    packetId: render.packetId,
    userId: args.userId,
    minRole: args.minRole,
  })
  return { ...access, packetId: render.packetId }
}

interface CreatePacketArgs {
  ownerId: string
  importId?: string | null
  packetName?: string | null
  cmfCode?: string | null
  notes?: string | null
  rows: CmfSkuRow[]
}

export async function createPacketFromRows(args: CreatePacketArgs) {
  const { ownerId, importId, rows } = args

  const inferredCmf =
    args.cmfCode ?? rows.map((r) => r.cmfCode).find((c) => Boolean(c)) ?? null

  const inferredName =
    args.packetName ??
    rows.map((r) => r.packetName).find((p) => Boolean(p)) ??
    rows[0]?.label ??
    'CMF Packet'

  return prisma.$transaction(async (tx) => {
    const packet = await tx.cmfPacket.create({
      data: {
        ownerId,
        importId: importId ?? null,
        name: inferredName,
        cmfCode: inferredCmf,
        notes: args.notes ?? null,
        status: 'draft',
      },
    })

    const renders = await Promise.all(
      rows.map((row, index) => {
        const product = getCmfProduct(row.productSlug)
        return tx.cmfRender.create({
          data: {
            packetId: packet.id,
            ownerId,
            label: row.label,
            productCode: row.productCode ?? null,
            ean: row.ean ?? null,
            productSlug: row.productSlug,
            variantSlug: row.variantSlug ?? 'default',
            colorwayName: row.colorwayName ?? null,
            componentSpecs: row.components,
            paletteSwatches: row.palette ?? [],
            modelId: row.modelId ?? product?.defaultModelId ?? null,
            sortOrder: index,
            status: 'draft',
          },
        })
      })
    )

    // Seed an activity row so the timeline starts from packet creation.
    await tx.cmfActivity.create({
      data: {
        packetId: packet.id,
        userId: ownerId,
        action: 'created_packet',
        metadata: {
          rows: rows.length,
          importId: importId ?? null,
        },
      },
    })

    return { packet, renders }
  })
}

/**
 * Find a packet that the user has access to (owner or member). Used by GET
 * routes — returns null when the user has no relationship to the packet.
 */
export async function findAccessiblePacket(packetId: string, userId: string) {
  const role = await getPacketRole(packetId, userId)
  if (!role) return null
  return prisma.cmfPacket.findUnique({
    where: { id: packetId },
    include: {
      renders: {
        orderBy: { sortOrder: 'asc' },
        include: {
          // Newest attempts first so the gallery defaults to the latest
          // attempt while still letting designers see history.
          renderAttempts: {
            orderBy: { attemptNumber: 'desc' },
          },
        },
      },
    },
  })
}

/**
 * List packets a user can see — packets they own AND packets they were
 * invited to. Sorted by recency. Adds a `role` field to each packet so the
 * UI can mark "shared with me" rows differently.
 */
export async function listAccessiblePackets(userId: string) {
  const packets = await prisma.cmfPacket.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      renders: {
        select: {
          id: true,
          label: true,
          status: true,
          renderUrl: true,
          colorwayName: true,
          productSlug: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      members: {
        where: { userId },
        select: { role: true },
      },
    },
  })

  return packets.map((p) => ({
    ...p,
    role: (p.ownerId === userId
      ? 'owner'
      : (p.members[0]?.role as CmfPacketRole) ?? 'viewer') as CmfPacketRole,
  }))
}

/* ─── Activity log ──────────────────────────────────────────────────────── */

export type CmfActivityAction =
  | 'created_packet'
  | 'imported_workbook'
  | 'edited_sku'
  | 'rendered_sku'
  | 'render_failed'
  | 'pdf_generated'
  | 'pdf_failed'
  | 'commented'
  | 'comment_resolved'
  | 'invited_member'
  | 'role_changed'
  | 'removed_member'
  | 'attempt_approved'
  | 'attempt_archived'
  | 'attempt_restored'
  | 'document_draft_saved'

/**
 * Append an activity row. Designed to be best-effort — never block the
 * primary action on failure to log.
 */
export async function logCmfActivity(args: {
  packetId: string
  userId: string
  action: CmfActivityAction
  targetId?: string | null
  metadata?: Record<string, unknown>
}) {
  try {
    await prisma.cmfActivity.create({
      data: {
        packetId: args.packetId,
        userId: args.userId,
        action: args.action,
        targetId: args.targetId ?? null,
        metadata: args.metadata ? (args.metadata as object) : undefined,
      },
    })
  } catch (err) {
    console.warn('[cmf/activity] failed to log activity', err)
  }
}
