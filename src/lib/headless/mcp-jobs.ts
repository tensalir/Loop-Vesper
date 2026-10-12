/**
 * The Prisma-backed store for MCP jobs (`headless_mcp_jobs`).
 *
 * The run-once logic lives in `./jobs.ts`; this file only reads and writes
 * rows. Jobs are scoped by owner, not by credential, so a person who signs
 * in again (a new credential) can still collect a job they started.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  PENDING_MAX_MS,
  PENDING_STALE_MESSAGE,
  pendingOf,
  type JobPayload,
  type JobRecord,
  type JobStatus,
  type JobStore,
} from './jobs'

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
    const candidates = await prisma.headlessMcpJob.findMany({
      where: {
        status: 'processing',
        OR: [
          { startedAt: { lt: olderThan } },
          { startedAt: null, updatedAt: { lt: olderThan } },
        ],
      },
      select: { id: true, status: true, result: true },
    })
    // A job waiting on its provider has no worker to lose; it fails only past PENDING_MAX_MS.
    const lost: string[] = []
    const overdue: string[] = []
    const pendingCutoff = Date.now() - PENDING_MAX_MS
    for (const row of candidates) {
      const pending = pendingOf({ status: row.status as JobStatus, result: row.result })
      if (!pending) lost.push(row.id)
      else if (Date.parse(pending.submittedAt) < pendingCutoff) overdue.push(row.id)
    }
    let count = 0
    if (lost.length > 0) {
      const updated = await prisma.headlessMcpJob.updateMany({
        where: { id: { in: lost }, status: 'processing' },
        data: { status: 'failed', error: message, completedAt: new Date() },
      })
      count += updated.count
    }
    if (overdue.length > 0) {
      const updated = await prisma.headlessMcpJob.updateMany({
        where: { id: { in: overdue }, status: 'processing' },
        data: { status: 'failed', error: PENDING_STALE_MESSAGE, completedAt: new Date() },
      })
      count += updated.count
    }
    return count
  },

  async listQueued(olderThan: Date, limit: number) {
    const rows = await prisma.headlessMcpJob.findMany({
      where: { status: 'queued', createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    return rows.map((row) => mapJob(row as JobRow))
  },

  async setPending(id, pending) {
    await prisma.headlessMcpJob.update({
      where: { id },
      data: { result: { pending } as never },
    })
  },

  // One conditional UPDATE, so two callers can never both take it.
  async leasePending(id, until) {
    const taken = await prisma.$executeRaw`
      UPDATE headless_mcp_jobs
      SET result = jsonb_set(result, '{pending,leaseUntil}', to_jsonb(${until.toISOString()}::text), true),
          updated_at = now()
      WHERE id = ${id}::uuid
        AND status = 'processing'
        AND result -> 'pending' IS NOT NULL
        AND (
          result -> 'pending' ->> 'leaseUntil' IS NULL
          OR (result -> 'pending' ->> 'leaseUntil')::timestamptz < now()
        )`
    return taken > 0
  },

  async releasePending(id) {
    await prisma.$executeRaw`
      UPDATE headless_mcp_jobs
      SET result = jsonb_set(result, '{pending,leaseUntil}', 'null'::jsonb, true), updated_at = now()
      WHERE id = ${id}::uuid AND status = 'processing' AND result -> 'pending' IS NOT NULL`
  },

  async listPending(limit) {
    // Processing video jobs are few; the handle is read from the row rather than queried in JSON.
    const rows = await prisma.headlessMcpJob.findMany({
      where: { status: 'processing', toolName: 'generate_video' },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(limit * 4, 20),
    })
    return rows
      .map((row) => mapJob(row as JobRow))
      .filter((job) => pendingOf(job) !== null)
      .slice(0, limit)
  },
}
