/**
 * The CMF team's records, one set for both doors: the team project every CMF render is saved in,
 * and the supplier PDFs made from them (`cmf_supplier_pdfs`).
 *
 * Why it is here (2026-09-30): a CMF render made through Claude was saved in its maker's private
 * project "Claude", and a web CMF Studio attempt in its own tables, so neither door saw the other's
 * work and no one saw a teammate's. The owner ruled that every CMF render, grade, answer and PDF is
 * the whole CMF team's, in both doors. So:
 *
 *   - one project per deployment, found by `projects.system_key = 'cmf'` (a partial unique index
 *     keeps it one), made by the first render when it is missing, owned by whoever made it; every
 *     profile with CMF access who renders becomes its member (`scripts/cmf-team-project.ts` adds
 *     the rest once), and one who lost the access is dropped the next time anyone renders;
 *   - one session in it, "CMF", visible to the members;
 *   - every render from either door is recorded there with the same `parameters.creative`, the
 *     door named in `parameters.source` (`mcp` or `web`);
 *   - every supplier PDF cmf_pdf saves gets a row.
 *
 * Who may read and write is the CMF service's gate (`service.ts`); membership only makes the
 * project show in the web app's own project pages.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { prismaGenerationRecordStore, type GenerationRecordStore, type RecordedOutput } from '@/lib/headless/record-generation'
import { CMF_TEAM_DESCRIPTION, CMF_TEAM_KEY, CMF_TEAM_NAME, CMF_TEAM_SESSION } from './team-project'

export { CMF_TEAM_KEY, CMF_TEAM_NAME, CMF_TEAM_SESSION, isCmfRender, namesCmfTabOrKey, planCmfMove, type MoveCandidate, type MovePlan } from './team-project'

type Json = Record<string, unknown>

// ------------------------------------------------------------------ the store

export interface TeamRenderRow {
  outputId: string
  generationId: string
  fileUrl: string
  createdAt: Date
  makerId: string
  makerName: string | null
  parameters: Json | null
}

export interface SupplierPdfRecord {
  id: string
  storagePath: string
  url: string
  fileName: string
  importId: string
  tab: string
  skuColumns: string[]
  skuNames: Record<string, string | null>
  outputIds: string[]
  keyId: string
  keySha256: string
  keyConfirmedBy: string | null
  workbookFile: string | null
  workbookSha256: string | null
  workbookModified: string | null
  check: { clean: boolean; cells_compared: number; rows_compared: number }
  renders: unknown
  kitVersion: string | null
  kitTag: string | null
  kitCommit: string | null
  madeBy: string
  credentialId: string | null
  door: 'mcp' | 'web'
  createdAt: Date
}

export type NewSupplierPdfRecord = Omit<SupplierPdfRecord, 'id' | 'createdAt'>

export interface CmfTeamStore extends Pick<GenerationRecordStore, 'writeGeneration' | 'enqueueAnalyses'> {
  findTeamProject(): Promise<{ id: string; ownerId: string } | null>
  /** Returns null when another request made it first (the unique index). */
  createTeamProject(input: { ownerId: string; name: string; description: string }): Promise<{ id: string; ownerId: string } | null>
  /** Makes the profile a member (the owner needs none) and drops members who lost CMF access. */
  syncMember(project: { id: string; ownerId: string }, profileId: string): Promise<void>
  findSession(projectId: string, name: string, type: string): Promise<{ id: string } | null>
  createSession(input: { projectId: string; name: string; type: string }): Promise<{ id: string }>
  /** The newest CMF renders in the team project, newest first. */
  recentRenders(projectId: string, limit: number): Promise<TeamRenderRow[]>
  insertSupplierPdf(row: NewSupplierPdfRecord): Promise<{ id: string }>
  recentSupplierPdfs(limit: number): Promise<SupplierPdfRecord[]>
  /** Display names by profile id, for the listings. */
  profileNames(ids: string[]): Promise<Map<string, string | null>>
}

/** The team project, made when missing, with the profile as its member. */
export async function ensureCmfTeamProject(store: CmfTeamStore, profileId: string): Promise<{ id: string; ownerId: string }> {
  let project = await store.findTeamProject()
  if (!project) {
    project = (await store.createTeamProject({ ownerId: profileId, name: CMF_TEAM_NAME, description: CMF_TEAM_DESCRIPTION })) ?? (await store.findTeamProject())
    if (!project) throw new Error('Could not make the CMF team project.')
  }
  await store.syncMember(project, profileId)
  return project
}

/** The team project's CMF session, made when missing, visible to every member. */
export async function ensureCmfTeamSession(store: CmfTeamStore, projectId: string): Promise<string> {
  const existing = await store.findSession(projectId, CMF_TEAM_SESSION.name, CMF_TEAM_SESSION.type)
  if (existing) return existing.id
  return (await store.createSession({ projectId, name: CMF_TEAM_SESSION.name, type: CMF_TEAM_SESSION.type })).id
}

export interface RecordCmfRenderInput {
  /** Who made it: the generation's user. */
  ownerId: string
  /** Also the storage folder of the files, so the two can be matched. */
  generationId: string
  modelId: string
  prompt: string
  parameters: Json
  outputs: RecordedOutput[]
  costUsd: number | null
  source: 'mcp' | 'web'
}

export interface RecordCmfRenderResult {
  projectId: string
  sessionId: string
  generationId: string
  outputIds: string[]
}

/** A CMF render's generation and outputs, in the team project, whichever door it came through. */
export async function recordCmfRender(input: RecordCmfRenderInput, store: CmfTeamStore = prismaCmfTeamStore): Promise<RecordCmfRenderResult> {
  const project = await ensureCmfTeamProject(store, input.ownerId)
  const sessionId = await ensureCmfTeamSession(store, project.id)
  const outputs = input.outputs.map((out) => ({
    id: randomUUID(),
    generationId: input.generationId,
    fileUrl: out.url,
    fileType: 'image' as const,
    width: out.width ?? null,
    height: out.height ?? null,
    duration: out.duration ?? null,
  }))
  await store.writeGeneration({
    generation: {
      id: input.generationId,
      sessionId,
      userId: input.ownerId,
      modelId: input.modelId,
      prompt: input.prompt,
      parameters: { ...input.parameters, source: input.source },
      cost: input.costUsd,
    },
    outputs,
    projectId: project.id,
  })
  const outputIds = outputs.map((o) => o.id)
  await store.enqueueAnalyses(outputIds).catch((err: unknown) => {
    // As for every other draw: analysis is best-effort.
    console.warn('[cmf/record] failed to enqueue analysis', (err as Error)?.message)
  })
  return { projectId: project.id, sessionId, generationId: input.generationId, outputIds }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

function toSupplierPdf(r: Record<string, any>): SupplierPdfRecord {
  return {
    id: r.id,
    storagePath: r.storagePath,
    url: r.url,
    fileName: r.fileName,
    importId: r.importId,
    tab: r.tab,
    skuColumns: r.skuColumns,
    skuNames: (r.skuNames ?? {}) as Record<string, string | null>,
    outputIds: r.outputIds,
    keyId: r.keyId,
    keySha256: r.keySha256,
    keyConfirmedBy: r.keyConfirmedBy ?? null,
    workbookFile: r.workbookFile ?? null,
    workbookSha256: r.workbookSha256 ?? null,
    workbookModified: r.workbookModified ?? null,
    check: r.check as SupplierPdfRecord['check'],
    renders: r.renders,
    kitVersion: r.kitVersion ?? null,
    kitTag: r.kitTag ?? null,
    kitCommit: r.kitCommit ?? null,
    madeBy: r.madeBy,
    credentialId: r.credentialId ?? null,
    door: r.door as SupplierPdfRecord['door'],
    createdAt: r.createdAt,
  }
}

export const prismaCmfTeamStore: CmfTeamStore = {
  async findTeamProject() {
    return prisma.project.findFirst({ where: { systemKey: CMF_TEAM_KEY }, orderBy: { createdAt: 'asc' }, select: { id: true, ownerId: true } })
  },
  async createTeamProject({ ownerId, name, description }) {
    try {
      return await prisma.project.create({ data: { ownerId, name, description, systemKey: CMF_TEAM_KEY, isShared: false }, select: { id: true, ownerId: true } })
    } catch (err) {
      if (isUniqueViolation(err)) return null
      throw err
    }
  },
  async syncMember(project, profileId) {
    if (project.ownerId !== profileId) {
      await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: profileId, role: 'editor' }], skipDuplicates: true })
    }
    await prisma.projectMember.deleteMany({
      where: {
        projectId: project.id,
        user: { OR: [{ pausedAt: { not: null } }, { deletedAt: { not: null } }, { AND: [{ cmfAccess: false }, { role: { not: 'admin' } }] }] },
      },
    })
  },
  async findSession(projectId, name, type) {
    return prisma.session.findFirst({ where: { projectId, name, type }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  },
  async createSession({ projectId, name, type }) {
    return prisma.session.create({ data: { projectId, name, type, isPrivate: false }, select: { id: true } })
  },
  writeGeneration: (input) => prismaGenerationRecordStore.writeGeneration(input),
  enqueueAnalyses: (ids) => prismaGenerationRecordStore.enqueueAnalyses(ids),
  async recentRenders(projectId, limit) {
    const rows = await prisma.output.findMany({
      where: { generation: { session: { projectId }, parameters: { path: ['toolName'], equals: 'cmf_render' } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fileUrl: true,
        createdAt: true,
        generationId: true,
        generation: { select: { userId: true, parameters: true, user: { select: { displayName: true, username: true } } } },
      },
    })
    return rows.map((r) => ({
      outputId: r.id,
      generationId: r.generationId,
      fileUrl: r.fileUrl,
      createdAt: r.createdAt,
      makerId: r.generation.userId,
      makerName: r.generation.user.displayName || r.generation.user.username || null,
      parameters: (r.generation.parameters ?? null) as Json | null,
    }))
  },
  async insertSupplierPdf(row) {
    return prisma.cmfSupplierPdf.create({
      data: { ...row, skuNames: row.skuNames as never, check: row.check as never, renders: row.renders as never },
      select: { id: true },
    })
  },
  async recentSupplierPdfs(limit) {
    const rows = await prisma.cmfSupplierPdf.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return rows.map((r) => toSupplierPdf(r))
  },
  async profileNames(ids) {
    if (!ids.length) return new Map()
    const rows = await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } })
    return new Map(rows.map((r) => [r.id, r.displayName || r.username || null]))
  },
}
