import type { JobPayload, JobRecord, JobStore } from '../../src/lib/headless/jobs'

/** An in-memory `JobStore` for tests: same contract as the Prisma store, no database. */
export class MemoryJobStore implements JobStore {
  rows = new Map<string, JobRecord>()
  private seq = 0

  async create(input: {
    credentialId: string
    ownerId: string
    toolName: string
    modelId: string
    request: Record<string, unknown>
  }) {
    const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`
    const now = new Date()
    this.rows.set(id, {
      id,
      credentialId: input.credentialId,
      ownerId: input.ownerId,
      toolName: input.toolName,
      modelId: input.modelId,
      status: 'processing',
      request: input.request,
      result: null,
      error: null,
      attempts: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
    })
    return { id }
  }

  /** Seed a row as the old code wrote it. */
  seed(row: Partial<JobRecord> & Pick<JobRecord, 'id' | 'status' | 'toolName' | 'request'>): JobRecord {
    const now = new Date()
    const full: JobRecord = {
      credentialId: 'cred-1',
      ownerId: 'owner-1',
      modelId: 'gemini-nano-banana-pro',
      result: null,
      error: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      ...row,
    }
    this.rows.set(full.id, full)
    return full
  }

  async complete(id: string, payload: JobPayload) {
    const row = this.rows.get(id)!
    this.rows.set(id, { ...row, status: 'completed', result: payload, error: null, completedAt: new Date() })
  }

  async fail(id: string, message: string) {
    const row = this.rows.get(id)!
    this.rows.set(id, { ...row, status: 'failed', error: message, completedAt: new Date() })
  }

  async claimQueued(id: string) {
    const row = this.rows.get(id)
    if (!row || row.status !== 'queued') return false
    this.rows.set(id, { ...row, status: 'processing', startedAt: new Date(), attempts: row.attempts + 1 })
    return true
  }

  async get(id: string, ownerId: string) {
    const row = this.rows.get(id)
    return row && row.ownerId === ownerId ? row : null
  }

  async failStale(olderThan: Date, message: string) {
    let n = 0
    for (const row of Array.from(this.rows.values())) {
      const since = row.startedAt ?? row.updatedAt
      if (row.status === 'processing' && since < olderThan) {
        await this.fail(row.id, message)
        n++
      }
    }
    return n
  }

  async listQueued(olderThan: Date, limit: number) {
    return Array.from(this.rows.values())
      .filter((r) => r.status === 'queued' && r.createdAt < olderThan)
      .slice(0, limit)
  }
}

/** Collects the promises handed to waitUntil so a test can await them. */
export function collectingWaitUntil(): { waitUntil: (p: Promise<unknown>) => void; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (p) => {
      pending.push(p)
    },
    settle: async () => {
      await Promise.allSettled(pending)
    },
  }
}
