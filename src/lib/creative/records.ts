/**
 * What Vesper keeps of the creative work: every grade (Vesper's three reads, or Claude's own look,
 * each labelled by its judge and never pooled), every decider's answer, and the manifest of every
 * product draw (`generate_product_image`) and every CMF render (`cmf_render`, from Claude or the CMF
 * Studio). The plugin repository reads them back nightly through the export
 * (`GET /api/headless/v1/creative/{grades,verdicts,manifests}`) into its `record/feedback/`.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface GradeRecord {
  id: string
  product: string
  ownerId: string
  credentialId: string | null
  outputId: string | null
  imageUrl: string | null
  frontifyAssetId: string | null
  imageSha256: string
  colourway: string | null
  view: string | null
  viewAssumed: boolean
  claimSource: string | null
  judge: 'vesper' | 'chat'
  judgeModel: string | null
  reads: number
  templateId: string | null
  kitVersion: string
  kitCommit: string
  rubricVersion: string
  runs: unknown
  fails: Record<string, number>
  failed: string[]
  failedAdvisory: string[]
  verdict: string
  verdictMajority: string | null
  unstable: boolean
  errors: number
  references: unknown
  latencyMs: number | null
  costUsd: number | null
  createdAt: Date
}

export type NewGrade = Omit<GradeRecord, 'id' | 'createdAt'>

export interface VerdictRecord {
  id: string
  product: string
  profileId: string
  credentialId: string | null
  gradeId: string | null
  outputId: string | null
  imageUrl: string | null
  frontifyAssetId: string | null
  imageSha256: string | null
  answer: 'yes' | 'no'
  remark: string | null
  decoded: string[]
  decodedUnconfirmed: string[]
  route: 'frontify-comment' | 'vesper'
  commentLine: string | null
  kitVersion: string
  rubricVersion: string | null
  createdAt: Date
}

export type NewVerdict = Omit<VerdictRecord, 'id' | 'createdAt'>

export interface ImageKey {
  product: string
  outputId?: string | null
  frontifyAssetId?: string | null
  imageSha256?: string | null
}

export interface CreativeRecordStore {
  insertGrade(g: NewGrade): Promise<{ id: string }>
  getGrade(id: string): Promise<GradeRecord | null>
  /** The newest grade of this picture, Vesper's or Claude's. */
  latestGrade(key: ImageKey): Promise<GradeRecord | null>
  insertVerdict(v: NewVerdict): Promise<{ id: string }>
}

function toGrade(r: Prisma.CreativeGradeGetPayload<Record<string, never>>): GradeRecord {
  return {
    ...r,
    judge: r.judge as GradeRecord['judge'],
    fails: (r.fails as Record<string, number>) ?? {},
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
  }
}

export const prismaCreativeRecords: CreativeRecordStore = {
  async insertGrade(g) {
    const row = await prisma.creativeGrade.create({
      data: {
        ...g,
        runs: g.runs as Prisma.InputJsonValue,
        fails: g.fails as Prisma.InputJsonValue,
        references: g.references as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    return row
  },
  async getGrade(id) {
    const row = await prisma.creativeGrade.findUnique({ where: { id } })
    return row ? toGrade(row) : null
  },
  async latestGrade(key) {
    const or: Prisma.CreativeGradeWhereInput[] = []
    if (key.outputId) or.push({ outputId: key.outputId })
    if (key.frontifyAssetId) or.push({ frontifyAssetId: key.frontifyAssetId })
    if (key.imageSha256) or.push({ imageSha256: key.imageSha256 })
    if (or.length === 0) return null
    const row = await prisma.creativeGrade.findFirst({
      where: { product: key.product, OR: or },
      orderBy: { createdAt: 'desc' },
    })
    return row ? toGrade(row) : null
  },
  async insertVerdict(v) {
    return prisma.creativeVerdict.create({ data: v, select: { id: true } })
  },
}

export type ExportKind = 'grades' | 'verdicts' | 'manifests'

/** The draws whose manifest lines the export serves: a Loop product draw, and a CMF render from either door. */
export const MANIFEST_TOOLS = ['generate_product_image', 'cmf_render'] as const

/** One manifest row of the export, from a generation's parameters; null when it is another product's. */
export function manifestRow(r: { id: string; createdAt: Date; parameters: unknown }, product?: string): { generation_id: string; created_at: Date; product: unknown; manifest: unknown } | null {
  const p = (r.parameters ?? {}) as Record<string, unknown>
  if (!MANIFEST_TOOLS.includes(p.toolName as (typeof MANIFEST_TOOLS)[number])) return null
  const creative = (p.creative ?? {}) as Record<string, unknown>
  if (product && creative.product !== product) return null
  return { generation_id: r.id, created_at: r.createdAt, product: creative.product ?? null, manifest: p.manifest ?? null }
}

export interface ExportQuery {
  product?: string
  since?: Date
  limit: number
}

/** Rows for the repository's nightly pull, oldest first from `since`, so it can page forward. */
export async function exportCreativeRecords(kind: ExportKind, q: ExportQuery): Promise<unknown[]> {
  const since = q.since ?? new Date(0)
  if (kind === 'grades') {
    const rows = await prisma.creativeGrade.findMany({
      where: { createdAt: { gt: since }, ...(q.product ? { product: q.product } : {}) },
      orderBy: { createdAt: 'asc' },
      take: q.limit,
    })
    return rows.map((r) => {
      const g = toGrade(r)
      // The owner is a Vesper id, not a name: the repository never needs to know who asked for a grade.
      const { ownerId: _o, credentialId: _c, ...rest } = g
      return rest
    })
  }
  if (kind === 'verdicts') {
    const rows = await prisma.creativeVerdict.findMany({
      where: { createdAt: { gt: since }, ...(q.product ? { product: q.product } : {}) },
      orderBy: { createdAt: 'asc' },
      take: q.limit,
    })
    const ids = Array.from(new Set(rows.map((r) => r.profileId)))
    const people = ids.length
      ? await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } })
      : []
    const name = new Map(people.map((p) => [p.id, p.displayName || p.username || null]))
    return rows.map(({ credentialId: _c, ...r }) => ({
      ...r,
      // The answer is the person's, so the record names them, as a Frontify comment would.
      decider: name.get(r.profileId) ?? null,
    }))
  }
  const rows = await prisma.generation.findMany({
    where: {
      createdAt: { gt: since },
      OR: MANIFEST_TOOLS.map((tool) => ({ parameters: { path: ['toolName'], equals: tool } })),
    },
    orderBy: { createdAt: 'asc' },
    take: q.limit,
    select: { id: true, createdAt: true, parameters: true },
  })
  return rows.map((r) => manifestRow(r, q.product)).filter((r) => r !== null)
}
