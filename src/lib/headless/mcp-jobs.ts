/**
 * The Prisma-backed store for MCP jobs (`headless_mcp_jobs`).
 *
 * The run-once logic lives in `./jobs.ts`; this file only reads and writes
 * rows. Jobs are scoped by owner, not by credential, so a person who signs
 * in again (a new credential) can still collect a job they started.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { JobPayload, JobRecord, JobStatus, JobStore } from './jobs'

type JobRow = {
  id: string
  credentialId: string
  ownerId: string
  toolName: string
  modelId: string
  status: string
  request: unknown
  result: unknown
  error: string | null
  attempts: number
  startedAt: Date | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    credentialId: row.credentialId,
    ownerId: row.ownerId,
    toolName: row.toolName,
    modelId: row.modelId,
    status: row.status as JobStatus,
    request: (row.request as Record<string, unknown>) ?? {},
    result: row.result ?? null,
    error: row.error,
    attempts: row.attempts ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt,
  }
}

export const prismaJobStore: JobStore = {
  async create(input) {
    const now = new Date()
    const row = await prisma.headlessMcpJob.create({
      data: {
        id: randomUUID(),
        credentialId: input.credentialId,
        ownerId: input.ownerId,
        toolName: input.toolName,
        modelId: input.modelId,
        status: 'processing',
        attempts: 1,
        startedAt: now,
        request: input.request as never,
      },
      select: { id: true },
    })
    return { id: row.id }
  },

  async complete(id: string, payload: JobPayload) {
    await prisma.headlessMcpJob.update({
      where: { id },
      data: {
        status: 'completed',
        result: payload as never,
        outputIds: payload.outputIds,
        error: null,
        completedAt: new Date(),
      },
    })
  },

  async fail(id: string, message: string) {
    await prisma.headlessMcpJob.update({
      where: { id },
      data: { status: 'failed', error: message, completedAt: new Date() },
    })
  },

  async claimQueued(id: string) {
    const updated = await prisma.headlessMcpJob.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'processing', startedAt: new Date(), attempts: { increment: 1 } },
    })
    return updated.count > 0
  },

  async get(id: string, ownerId: string) {
    const row = await prisma.headlessMcpJob.findFirst({ where: { id, ownerId } })
    return row ? mapJob(row as JobRow) : null
  },

  async failStale(olderThan: Date, message: string) {
    const updated = await prisma.headlessMcpJob.updateMany({
      where: {
        status: 'processing',
        OR: [
          { startedAt: { lt: olderThan } },
          { startedAt: null, updatedAt: { lt: olderThan } },
        ],
      },
      data: { status: 'failed', error: message, completedAt: new Date() },
    })
    return updated.count
  },

  async listQueued(olderThan: Date, limit: number) {
    const rows = await prisma.headlessMcpJob.findMany({
      where: { status: 'queued', createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    return rows.map((row) => mapJob(row as JobRow))
  },
}
