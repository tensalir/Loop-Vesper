/**
 * A whole CMF world for the service tests, with no database, storage or model: the sample product
 * kit (its CMF decider given a test email, its front key's clown given bytes Vesper holds), one
 * workbook upload, the team's records in memory (`memory-cmf-team.ts`), grades and answers in
 * memory, and a model that draws a flat picture and reads every check as passed.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { kitPins, type PinRow } from '../../src/lib/creative/pins'
import type { CmfKit } from '../../src/lib/creative/cmf/kit-cmf'
import type { ClownKeyFile } from '../../src/lib/creative/cmf/prompt-fill'
import type { Spec } from '../../src/lib/creative/cmf/spec-diff'
import type { CmfActor, CmfDoor, CmfServiceDeps } from '../../src/lib/creative/cmf/service'
import type { CreativeRecordStore, GradeRecord, ImageKey, NewGrade, NewVerdict, VerdictRecord } from '../../src/lib/creative/records'
import { png, specToXlsx, testConfirmed, withTestFilledBanner } from './cmf-supplier'
import { DECIDER, E2CC, FRONT, IMPORT, KEY_ID, kitWith, UPLOAD_NAME } from './cmf-upload'
import { MemoryCmfTeam } from './memory-cmf-team'

export const DAMIEN = 'dddddddd-0000-4000-8000-00000000da01'
export const MAYA = 'dddddddd-0000-4000-8000-00000000da02'
export const OUTSIDER = 'dddddddd-0000-4000-8000-00000000da03'
export const PAYLOAD_E = 'experience-2-cc--E--case-experience2--front'
export const WEB_ATTEMPT = 'bbbbbbbb-0000-4000-8000-000000000001'

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

/** Grades and answers in memory, as `prismaCreativeRecords` keeps them. */
export class MemoryRecords implements CreativeRecordStore {
  grades: GradeRecord[] = []
  verdicts: VerdictRecord[] = []
  private n = 0
  private at(): Date {
    this.n += 1
    return new Date(Date.UTC(2026, 8, 30, 10, 0, this.n))
  }
  private id(kind: string): string {
    return `eeeeeeee-0000-4000-8000-${kind}${String(this.n).padStart(10, '0')}`
  }
  async insertGrade(g: NewGrade) {
    const createdAt = this.at()
    const rec = { ...g, id: this.id('g0'), createdAt }
    this.grades.push(rec)
    return { id: rec.id }
  }
  async getGrade(id: string) {
    return this.grades.find((g) => g.id === id) ?? null
  }
  async latestGrade(key: ImageKey) {
    const hit = this.grades
      .filter((g) => g.product === key.product && ((key.outputId && g.outputId === key.outputId) || (key.frontifyAssetId && g.frontifyAssetId === key.frontifyAssetId) || (key.imageSha256 && g.imageSha256 === key.imageSha256)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return hit[0] ?? null
  }
  async insertVerdict(v: NewVerdict) {
    const createdAt = this.at()
    const rec = { ...v, id: this.id('v0'), createdAt }
    this.verdicts.push(rec)
    return { id: rec.id }
  }
}

export interface ServiceWorld {
  cmf: CmfKit
  loaded: ReturnType<typeof kitWith>['loaded']
  key: ClownKeyFile
  clown: Buffer
  image: Buffer
  upload: Spec
  team: MemoryCmfTeam
  records: MemoryRecords
  /** Every file the fake storage was given, by path. */
  stored: string[]
  savedPdfs: string[]
  access: Set<string>
  deps: Partial<CmfServiceDeps>
}

/** An actor through one door: Claude's carries a credential, the web's none. */
export function actor(profileId: string, door: CmfDoor = 'mcp'): CmfActor {
  return { profileId, email: null, role: 'user', door, credentialId: door === 'mcp' ? `cred-${profileId.slice(-4)}` : null, allowedModels: door === 'mcp' ? ['*'] : [] }
}

export async function serviceWorld(opts: { confirmedKey?: boolean; upload?: Spec; access?: string[] } = {}): Promise<ServiceWorld> {
  const clown = await png(213, 28, 27, 64, 64)
  const image = await png(120, 160, 200)
  const key = testConfirmed(FRONT)
  key.clown = { ...key.clown!, sha256: sha(clown) }
  const { cmf, loaded } = kitWith((p) => {
    p.keys[KEY_ID].clown = { ...p.keys[KEY_ID].clown, sha256: sha(clown) }
    if (opts.confirmedKey) p.keys[KEY_ID].confirmed = true
  })
  const upload = opts.upload ?? withTestFilledBanner(E2CC, ['D', 'E', 'F'])
  const access = new Set(opts.access ?? [DAMIEN, MAYA])
  const team = new MemoryCmfTeam({ access: Array.from(access), names: { [DAMIEN]: 'Damien', [MAYA]: 'Maya' } })
  const records = new MemoryRecords()
  const stored: string[] = []
  const savedPdfs: string[] = []
  const emails: Record<string, string> = { [DAMIEN]: DECIDER, [MAYA]: 'maya@loop.test' }
  const pantonePath = ((cmf.product as Record<string, any>).pantone ?? {}).path
  const rows: PinRow[] = kitPins(loaded.kit)
    .filter((s) => s.product === cmf.slug)
    .map((s) => ({
      product: s.product,
      pinId: s.pinId,
      source: s.source,
      title: s.title,
      sha256: s.sha256,
      bytes: s.bytes,
      width: s.width,
      height: s.height,
      mime: 'image/png',
      storagePath: `pins/${s.sha256}.png`,
      previewPath: null,
      derivedPath: null,
      derivedSha256: null,
      derivedRecipe: null,
      geminiFileUri: `files/${s.sha256.slice(0, 10)}`,
      geminiFileExpiresAt: null,
      status: 'ok',
      error: null,
      syncedAt: new Date('2026-09-29T00:00:00Z'),
    }))
  const checks = cmf.product.rubric.checks
  const deps: Partial<CmfServiceDeps> = {
    loadKit: async () => loaded as any,
    readKitFile: async (_l, file) => {
      if (file.path === cmf.specs['experience-2-cc'].path) return Buffer.from(JSON.stringify(E2CC))
      if (file.path === cmf.product.grading_prompt?.parts_file?.path) {
        return fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'creative', 'product-cmf-grading.v1.sample.json'))
      }
      if (file.path === cmf.payloads[PAYLOAD_E]?.path) return fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'cmf', `${PAYLOAD_E}.payload.json`))
      if (pantonePath && file.path === pantonePath) return Buffer.from(JSON.stringify({ codes: {} }))
      return Buffer.from(JSON.stringify(key))
    },
    ownerAccess: async (id) => ({ admin: false, cmf: access.has(id) }),
    pinRows: async () => rows,
    pinBytes: async () => clown,
    fetchPdf: async () => Buffer.from('%PDF-1.7 not read'),
    packetPdf: async () => null,
    worker: () => null,
    workbook: {
      importRow: async (id) =>
        id === IMPORT ? { id, ownerId: MAYA, fileName: UPLOAD_NAME, storagePath: `cmf/${MAYA}/imports/${id}.xlsx`, createdAt: new Date('2026-09-22T09:20:41Z') } : null,
      bytes: async () => specToXlsx(upload),
      storedLastModified: async () => new Date('2026-09-22T09:20:42.000Z'),
    },
    recentImports: async () => [],
    pdf: {
      renderOutput: async (id) => team.renderOutput(id),
      webAttempt: async (id) => id === WEB_ATTEMPT,
      verdicts: async (outputId, product) =>
        records.verdicts
          .filter((v) => v.outputId === outputId && v.product === product)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((v) => ({ id: v.id, profileId: v.profileId, credentialId: v.credentialId, answer: v.answer, remark: v.remark, createdAt: v.createdAt })),
      verdictEmail: async (v) => emails[v.profileId] ?? null,
      imageBytes: async () => ({ bytes: image, mimeType: 'image/png' }),
      storePdf: async (p) => {
        savedPdfs.push(p)
        return `https://placeholder.supabase.co/storage/v1/object/public/generated-images/${p}`
      },
      now: () => new Date('2026-09-30T12:00:00Z'),
    },
    candidate: () => ({
      async findOwnOutput(outputId, ownerId) {
        const r = team.renderOutput(outputId)
        return r && r.ownerId === ownerId ? { fileUrl: r.fileUrl, parameters: r.parameters } : null
      },
      fetchUrl: async () => ({ bytes: image, contentType: 'image/png' }),
      fetchFrontify: async () => null,
    }),
    records,
    draw: {
      clownPart: async (row) => ({ file_data: { mime_type: 'image/png', file_uri: row.geminiFileUri! } }),
      image: async () => ({ bytes: image, mimeType: 'image/png' }),
      store: async (_bytes, _mime, p) => {
        stored.push(p)
        return `https://placeholder.supabase.co/storage/v1/object/public/generated-images/${p}`
      },
      size: async () => ({ width: 96, height: 96 }),
      clownUrl: async () => null,
    },
    grader: () => ({
      candidatePart: async (c) => ({ inline_data: { mime_type: c.mimeType, data: c.bytes.toString('base64') } }),
      pinPart: async (row) => ({ file_data: { mime_type: 'image/png', file_uri: row.geminiFileUri! } }),
      read: async () => ({ json: { checks: Object.fromEntries(checks.map((c) => [c.id, true])) }, model: 'gemini-flash-latest' }),
    }),
    team,
  }
  return { cmf, loaded, key, clown, image, upload, team, records, stored, savedPdfs, access, deps }
}
