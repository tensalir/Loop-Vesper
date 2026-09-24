/**
 * MCP draws land in the web app.
 *
 * Images made through the MCP connector were stored in Supabase but never
 * written as `generations`/`outputs` rows, so they never appeared in Vesper's
 * web app and could not be starred, iterated or found again. Each MCP draw is
 * now recorded in its owner's project "Claude" (found by
 * `projects.system_key = 'claude'`, so renaming it is safe), in one session
 * per stream, private by default. Outputs get their semantic analysis queued
 * the way the web worker (`/api/generate/process`) queues it.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export const CLAUDE_PROJECT_KEY = 'claude'
export const CLAUDE_PROJECT_NAME = 'Claude'
const CLAUDE_PROJECT_DESCRIPTION = 'Images and videos made from Claude through the Vesper connector.'

export type McpStream = 'free' | 'eclipse' | 'packaging' | 'cmf' | 'video'

export const STREAM_SESSIONS: Record<McpStream, { name: string; type: 'image' | 'video' }> = {
  free: { name: 'Free generation', type: 'image' },
  eclipse: { name: 'Eclipse', type: 'image' },
  packaging: { name: 'Packaging', type: 'image' },
  cmf: { name: 'CMF', type: 'image' },
  video: { name: 'Video', type: 'video' },
}

export interface RecordedOutput {
  url: string
  width: number | null
  height: number | null
  duration?: number | null
}

export interface RecordMcpGenerationInput {
  ownerId: string
  /** Also the storage folder of the files, so the two can be matched. */
  generationId: string
  stream: McpStream
  modelId: string
  prompt: string
  parameters: Record<string, unknown>
  outputs: RecordedOutput[]
  costUsd: number | null
}

export interface RecordMcpGenerationResult {
  projectId: string
  sessionId: string
  generationId: string
  outputIds: string[]
}

/** The few writes recording needs; Prisma in production, an in-memory fake in tests. */
export interface GenerationRecordStore {
  findSystemProject(ownerId: string, key: string): Promise<{ id: string } | null>
  /** Returns null when another request created it first (unique violation). */
  createSystemProject(input: { ownerId: string; key: string; name: string; description: string }): Promise<{ id: string } | null>
  findSession(projectId: string, name: string, type: string): Promise<{ id: string } | null>
  createSession(input: { projectId: string; name: string; type: string }): Promise<{ id: string }>
  writeGeneration(input: {
    generation: {
      id: string
      sessionId: string
      userId: string
      modelId: string
      prompt: string
      parameters: Record<string, unknown>
      cost: number | null
    }
    outputs: Array<{
      id: string
      generationId: string
      fileUrl: string
      fileType: 'image' | 'video'
      width: number | null
      height: number | null
      duration: number | null
    }>
    projectId: string
  }): Promise<void>
  enqueueAnalyses(outputIds: string[]): Promise<void>
}

export async function ensureClaudeProject(store: GenerationRecordStore, ownerId: string): Promise<string> {
  const existing = await store.findSystemProject(ownerId, CLAUDE_PROJECT_KEY)
  if (existing) return existing.id
  const created = await store.createSystemProject({
    ownerId,
    key: CLAUDE_PROJECT_KEY,
    name: CLAUDE_PROJECT_NAME,
    description: CLAUDE_PROJECT_DESCRIPTION,
  })
  if (created) return created.id
  const raced = await store.findSystemProject(ownerId, CLAUDE_PROJECT_KEY)
  if (!raced) throw new Error('Could not create the Claude project.')
  return raced.id
}

export async function ensureStreamSession(
  store: GenerationRecordStore,
  projectId: string,
  stream: McpStream
): Promise<string> {
  const spec = STREAM_SESSIONS[stream]
  const existing = await store.findSession(projectId, spec.name, spec.type)
  if (existing) return existing.id
  return (await store.createSession({ projectId, name: spec.name, type: spec.type })).id
}

export async function recordMcpGeneration(
  input: RecordMcpGenerationInput,
  store: GenerationRecordStore = prismaGenerationRecordStore
): Promise<RecordMcpGenerationResult> {
  const projectId = await ensureClaudeProject(store, input.ownerId)
  const sessionId = await ensureStreamSession(store, projectId, input.stream)
  const fileType = STREAM_SESSIONS[input.stream].type
  const outputs = input.outputs.map((out) => ({
    id: randomUUID(),
    generationId: input.generationId,
    fileUrl: out.url,
    fileType,
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
      parameters: { ...input.parameters, source: 'mcp' },
      cost: input.costUsd,
    },
    outputs,
    projectId,
  })

  const outputIds = outputs.map((o) => o.id)
  await store.enqueueAnalyses(outputIds).catch((err: unknown) => {
    // Same posture as the web worker: analysis is best-effort.
    console.warn('[mcp/record] failed to enqueue analysis', (err as Error)?.message)
  })

  return { projectId, sessionId, generationId: input.generationId, outputIds }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002'
}

export const prismaGenerationRecordStore: GenerationRecordStore = {
  async findSystemProject(ownerId, key) {
    return prisma.project.findFirst({ where: { ownerId, systemKey: key }, select: { id: true } })
  },
  async createSystemProject({ ownerId, key, name, description }) {
    try {
      return await prisma.project.create({
        data: { ownerId, name, description, systemKey: key, isShared: false },
        select: { id: true },
      })
    } catch (err) {
      if (isUniqueViolation(err)) return null
      throw err
    }
  },
  async findSession(projectId, name, type) {
    return prisma.session.findFirst({
      where: { projectId, name, type },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  },
  async createSession({ projectId, name, type }) {
    return prisma.session.create({ data: { projectId, name, type, isPrivate: true }, select: { id: true } })
  },
  async writeGeneration({ generation, outputs, projectId }) {
    const now = new Date()
    await prisma.$transaction([
      prisma.generation.create({
        data: {
          id: generation.id,
          sessionId: generation.sessionId,
          userId: generation.userId,
          modelId: generation.modelId,
          prompt: generation.prompt,
          parameters: generation.parameters as never,
          status: 'completed',
          cost: generation.cost,
        },
      }),
      prisma.output.createMany({ data: outputs }),
      // Bump the session and project so the draw sorts to the top of the web app.
      prisma.session.update({ where: { id: generation.sessionId }, data: { updatedAt: now } }),
      prisma.project.update({ where: { id: projectId }, data: { updatedAt: now } }),
    ])
  },
  async enqueueAnalyses(outputIds) {
    if (outputIds.length === 0) return
    await prisma.outputAnalysis.createMany({
      data: outputIds.map((outputId) => ({ outputId, status: 'queued' })),
      skipDuplicates: true,
    })
  },
}
