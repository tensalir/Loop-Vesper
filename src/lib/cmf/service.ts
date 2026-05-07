/**
 * Higher-level CMF service helpers used by API routes.
 *
 * - `requireAuthenticatedProfile` returns the calling user or short-circuits
 *   with the standard 401 response shape used elsewhere in this repo.
 * - `assertOwnsCmfPacket` / `assertOwnsCmfImport` throw if the requested
 *   resource is not owned by the calling user. API routes catch these and
 *   translate to 404 (we deliberately don't distinguish 403 from 404 here
 *   to avoid leaking which packet IDs exist).
 * - `createPacketFromRows` materialises the parsed SKU rows into a packet
 *   plus per-SKU `CmfRender` rows in a single transaction.
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

export interface AuthenticatedProfile {
  userId: string
  email: string | null
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

  // Confirm an active profile exists before letting the user create CMF
  // resources. This mirrors the posture in `/headless` and keeps deleted /
  // paused users out without leaking which state they're in.
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

export async function assertOwnsCmfRender(renderId: string, ownerId: string) {
  const render = await prisma.cmfRender.findFirst({
    where: { id: renderId, ownerId },
    select: { id: true },
  })
  if (!render) {
    throw new CmfNotFoundError('Render not found')
  }
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

    return { packet, renders }
  })
}

export async function findOwnedPacket(packetId: string, ownerId: string) {
  return prisma.cmfPacket.findFirst({
    where: { id: packetId, ownerId },
    include: {
      renders: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

export async function listOwnedPackets(ownerId: string) {
  return prisma.cmfPacket.findMany({
    where: { ownerId },
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
    },
  })
}
