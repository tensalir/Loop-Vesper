/**
 * Where read kits are kept, both plugins' in the same tables: `creative_kits` (a row per kit blob,
 * its plugin in `json.kit.plugin`) and `creative_kit_files`.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { AnyKit, Conformance } from './kit-schema'
import type { KitStore, StoredKit } from './kit'

interface KitRowJson {
  kit: AnyKit | null
  conformance: Conformance | null
}

function toStored(row: {
  blobSha: string
  commitSha: string
  ref: string
  version: string
  schema: number
  json: Prisma.JsonValue
  sizeBytes: number
  valid: boolean
  error: string | null
  fetchedAt: Date
}): StoredKit {
  const json = (row.json ?? {}) as unknown as KitRowJson
  return {
    blobSha: row.blobSha,
    commitSha: row.commitSha,
    ref: row.ref,
    version: row.version,
    schema: row.schema,
    valid: row.valid,
    error: row.error,
    kit: json.kit ?? null,
    conformance: json.conformance ?? null,
    sizeBytes: row.sizeBytes,
    fetchedAt: row.fetchedAt,
  }
}

export const prismaKitStore: KitStore = {
  async getByBlob(blobSha) {
    const row = await prisma.creativeKit.findUnique({ where: { blobSha } })
    return row ? toStored(row) : null
  },

  async latestValid(plugin) {
    // One table holds both plugins' kits; a kit is only ever its own plugin's fallback.
    const row = await prisma.creativeKit.findFirst({
      where: { valid: true, ...(plugin ? { json: { path: ['kit', 'plugin'], equals: plugin } } : {}) },
      orderBy: { fetchedAt: 'desc' },
    })
    return row ? toStored(row) : null
  },

  async save(kit: StoredKit) {
    const json = { kit: kit.kit, conformance: kit.conformance } as unknown as Prisma.InputJsonValue
    await prisma.creativeKit.upsert({
      where: { blobSha: kit.blobSha },
      create: {
        blobSha: kit.blobSha,
        commitSha: kit.commitSha,
        ref: kit.ref,
        version: kit.version,
        schema: kit.schema,
        json,
        sizeBytes: kit.sizeBytes,
        valid: kit.valid,
        error: kit.error,
        fetchedAt: kit.fetchedAt,
      },
      update: { commitSha: kit.commitSha, ref: kit.ref, valid: kit.valid, error: kit.error, json, fetchedAt: kit.fetchedAt },
    })
  },

  async getFile(blobSha) {
    const row = await prisma.creativeKitFile.findUnique({ where: { blobSha } })
    return row ? { sha256: row.sha256, content: Buffer.from(row.content) } : null
  },

  async saveFile(file) {
    await prisma.creativeKitFile.upsert({
      where: { blobSha: file.blobSha },
      create: { blobSha: file.blobSha, path: file.path, commitSha: file.commitSha, sha256: file.sha256, content: new Uint8Array(file.content) },
      update: {},
    })
  },
}
