/**
 * The CMF team's records in memory, for the CMF service tests: projects with their system key and
 * members, sessions, generations and outputs, and supplier PDF rows. It answers the way the Prisma
 * store does (`src/lib/creative/cmf/team-records.ts`), and can hand a recorded render back as the
 * row cmf_pdf and grade_image read.
 */

import type { CmfTeamStore, NewSupplierPdfRecord, SupplierPdfRecord, TeamRenderRow } from '../../src/lib/creative/cmf/team-records'
import type { RenderOutputRow } from '../../src/lib/creative/cmf/supplier-pdf-run'

export interface MemoryProject {
  id: string
  ownerId: string
  systemKey: string | null
  members: Set<string>
}

export interface MemoryGeneration {
  id: string
  sessionId: string
  userId: string
  modelId: string
  prompt: string
  parameters: Record<string, unknown>
  createdAt: Date
}

export class MemoryCmfTeam implements CmfTeamStore {
  projects: MemoryProject[] = []
  sessions: Array<{ id: string; projectId: string; name: string; type: string; isPrivate: boolean }> = []
  generations: MemoryGeneration[] = []
  outputs: Array<{ id: string; generationId: string; fileUrl: string; createdAt: Date }> = []
  pdfs: SupplierPdfRecord[] = []
  analyses: string[] = []
  /** Who has CMF access now: a member without it is dropped on the next sync. */
  access = new Set<string>()
  names = new Map<string, string | null>()
  private tick = 0
  private ids = 0

  /** Ids that are the same on every run, so what a test pins does not move. */
  private nextId(): string {
    this.ids += 1
    return `cccccccc-0000-4000-8000-${String(this.ids).padStart(12, '0')}`
  }

  constructor(opts: { access?: string[]; names?: Record<string, string> } = {}) {
    for (const a of opts.access ?? []) this.access.add(a)
    for (const [k, v] of Object.entries(opts.names ?? {})) this.names.set(k, v)
  }

  /** Strictly increasing times, so newest-first is well defined. */
  private now(): Date {
    this.tick += 1
    return new Date(Date.UTC(2026, 8, 30, 9, 0, this.tick))
  }

  async findTeamProject() {
    const p = this.projects.find((x) => x.systemKey === 'cmf')
    return p ? { id: p.id, ownerId: p.ownerId } : null
  }

  async createTeamProject(input: { ownerId: string; name: string; description: string }) {
    if (this.projects.some((x) => x.systemKey === 'cmf')) return null
    const p = { id: this.nextId(), ownerId: input.ownerId, systemKey: 'cmf', members: new Set<string>() }
    this.projects.push(p)
    return { id: p.id, ownerId: p.ownerId }
  }

  async syncMember(project: { id: string; ownerId: string }, profileId: string) {
    const p = this.projects.find((x) => x.id === project.id)!
    if (p.ownerId !== profileId) p.members.add(profileId)
    for (const m of Array.from(p.members)) if (!this.access.has(m)) p.members.delete(m)
  }

  async findSession(projectId: string, name: string, type: string) {
    const s = this.sessions.find((x) => x.projectId === projectId && x.name === name && x.type === type)
    return s ? { id: s.id } : null
  }

  async createSession(input: { projectId: string; name: string; type: string }) {
    const s = { id: this.nextId(), ...input, isPrivate: false }
    this.sessions.push(s)
    return { id: s.id }
  }

  async writeGeneration(input: Parameters<CmfTeamStore['writeGeneration']>[0]) {
    const at = this.now()
    this.generations.push({ ...input.generation, parameters: input.generation.parameters, createdAt: at })
    for (const o of input.outputs) this.outputs.push({ id: o.id, generationId: o.generationId, fileUrl: o.fileUrl, createdAt: at })
  }

  async enqueueAnalyses(ids: string[]) {
    this.analyses.push(...ids)
  }

  async recentRenders(projectId: string, limit: number): Promise<TeamRenderRow[]> {
    const sessions = new Set(this.sessions.filter((s) => s.projectId === projectId).map((s) => s.id))
    return this.outputs
      .map((o) => ({ o, g: this.generations.find((g) => g.id === o.generationId)! }))
      .filter(({ g }) => sessions.has(g.sessionId) && g.parameters.toolName === 'cmf_render')
      .sort((a, b) => b.o.createdAt.getTime() - a.o.createdAt.getTime())
      .slice(0, limit)
      .map(({ o, g }) => ({
        outputId: o.id,
        generationId: g.id,
        fileUrl: o.fileUrl,
        createdAt: o.createdAt,
        makerId: g.userId,
        makerName: this.names.get(g.userId) ?? null,
        parameters: g.parameters,
      }))
  }

  async insertSupplierPdf(row: NewSupplierPdfRecord) {
    const rec = { ...row, id: this.nextId(), createdAt: this.now() }
    this.pdfs.push(rec)
    return { id: rec.id }
  }

  async recentSupplierPdfs(limit: number) {
    return [...this.pdfs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit)
  }

  async profileNames(ids: string[]) {
    return new Map(ids.map((id) => [id, this.names.get(id) ?? null]))
  }

  /** A recorded output as cmf_pdf and the grade read it, or null. */
  renderOutput(outputId: string): RenderOutputRow | null {
    const o = this.outputs.find((x) => x.id === outputId)
    if (!o) return null
    const g = this.generations.find((x) => x.id === o.generationId)!
    return { id: o.id, fileUrl: o.fileUrl, generationId: g.id, ownerId: g.userId, parameters: g.parameters }
  }

  /** The project a generation sits in. */
  projectOf(generationId: string): MemoryProject | null {
    const g = this.generations.find((x) => x.id === generationId)
    const s = g ? this.sessions.find((x) => x.id === g.sessionId) : null
    return s ? this.projects.find((p) => p.id === s.projectId) ?? null : null
  }
}
