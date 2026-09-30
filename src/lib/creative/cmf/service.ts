/**
 * CMF, one engine behind both doors: every CMF step Vesper takes, whether Claude asks through the
 * MCP tools (`src/lib/headless/tools/cmf.ts`, `creative-grade.ts`, `creative-verdict.ts`) or a
 * person asks in the web CMF Studio.
 *
 * Why it is here (2026-09-30): the web CMF Studio and the Claude door shared almost no code. The
 * web built its own prompt (lighting presets, refinement text, a model rewrite), rotated the clown,
 * fell back to Replicate, kept an approve flag and built an unchecked PDF; Claude filled Damien's
 * template by code, drew on the kit's lane with one pinned clown, graded against the kit's rubric,
 * recorded a yes or no and read its supplier PDF back before saving it. Neither read the other's
 * records. The owner ruled that the headless engine is the behaviour, so it moved here, unchanged,
 * and both doors call it. A CMF step is changed here or nowhere.
 *
 *   listCmf          the kit's tabs, SKUs, keys and ready prompts, the newest uploads, and the
 *                    team's newest renders (grade, answers, whether each can go on a supplier PDF)
 *                    and supplier PDFs, from either door
 *   cmfPrompt        Damien's template filled by code (an upload's cells, or the kit's payload)
 *   planRender       every refusal before anything is paid for; then runRender draws and records
 *                    the render in the CMF team project (`team-records.ts`)
 *   planGrade        the kit's grader for one render, against the kit's row or an upload's
 *                    (`grading-row.ts`); runGrade reads it and stores the grade
 *   recordCmfVerdict a person's yes or no on a render, and whether the kit names them its decider
 *   supplierPdf      the supplier PDF from one upload and approved renders of the team's, checked,
 *                    then saved and listed (`cmf_supplier_pdfs`)
 *   checkPdf         every value on a CMF PDF against its sheet cell
 *   uploadWorkbook   a workbook export kept for the team, read by the same parse every step uses
 *   readUpload       an upload's tabs and SKUs by column letter, each tab's keys and their state
 *   cmfKeys          the kit's clown keys and their clowns, read only
 *
 * Every function takes the actor (who asks, through which door) and applies one gate: CMF access
 * on the profile (`cmf_access`, or an admin), read fresh on every call. Every render, grade, answer
 * and supplier PDF is the whole CMF team's: any CMF actor reads and uses any of them, whoever made
 * it and through whichever door. What a door does beyond that (parsing its arguments, the words it
 * answers with, running a long call as a job) stays in the door. Pure where it can be; everything
 * it reaches is in `CmfServiceDeps`, so tests swap it.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getProductKit, readKitFile } from '@/lib/creative/kit-runtime'
import type { LoadedKit as LoadedKitOf } from '@/lib/creative/kit'
import type { AnyKit, KitProduct } from '@/lib/creative/kit-schema'
import { kitHeader } from '@/lib/creative/tool-views'
import { kitPins, usablePin, type PinRow, type PinSpec } from '@/lib/creative/pins'
import { pinStorage, prismaPinStore } from '@/lib/creative/pins-runtime'
import { pinPart } from '@/lib/creative/pin-parts'
import { drawImage, type GeminiPart } from '@/lib/creative/gemini'
import {
  anchorUrl,
  candidatePartFor,
  drawPriceUsd,
  geminiDeps,
  GRADE_READ_USD,
  gradeReader,
  imageSize,
  pinPartDeps,
  productionCandidateDeps,
  storeDrawn,
  vesperModelId,
} from '@/lib/creative/work-runtime'
import { loadCandidate, type CandidateDeps, type LoadedCandidate } from '@/lib/creative/candidate'
import type { GradeDeps, GradeOutcome } from '@/lib/creative/grade'
import { prismaCreativeRecords, type CreativeRecordStore, type GradeRecord } from '@/lib/creative/records'
import { fetchAllowlisted } from '@/lib/net/fetch-allowlisted'
import { CMF_STORAGE_BUCKET, importStoragePath } from '@/lib/cmf/storage'
import { assertModelAllowed } from '@/lib/headless/tools/types'
import { CmfError, cmfKit, inScopeColumns, keysForTab, payloadFor, resolveKey, resolveTab, type CmfGradingParts, type CmfKit, type CmfPayloadEntry, type CmfSpec } from './kit-cmf'
import {
  checkClownBytes,
  cmfDrawRequest,
  cmfManifestLine,
  executeCmfDraws,
  planCmfRender,
  planCmfRenderFromWorkbook,
  type CmfDrawn,
  type CmfLane,
  type CmfPayload,
  type CmfRenderPlan,
} from './render'
import { checkPdfInVesper, checkPdfOnWorker, sha256Hex, type SpecCheckResult } from './check-pdf'
import { workerConfigFromEnv, type WorkerConfig } from './worker-client'
import type { ClownKey, Spec } from './spec-diff'
import { PromptRefusal, skuSpecChanges, skuSpecView, type ClownKeyFile, type SkuSpecView } from './prompt-fill'
import { buildWorkbookPayload } from './workbook-payload'
import { parseWorkbookBytes, workbookInfoForUpload } from './workbook'
import { loadStoredWorkbook, workbookTab, type WorkbookImportRow, type WorkbookSourceDeps } from './workbook-source'
import { CmfPdfRefused, deciderEmails, runCmfPdf, type CmfPdfArgs, type CmfPdfDeps, type CmfPdfResult, type RenderOutputRow, type VerdictRow } from './supplier-pdf-run'
import type { SupplierPdfImage } from './supplier-pdf'
import { checkCmfTarget, gradeCmfCandidate } from './grading'
import { gradingPartsFor, type PantoneLookup } from './grading-row'
import { isCmfRender, prismaCmfTeamStore, recordCmfRender, type CmfTeamStore, type SupplierPdfRecord, type TeamRenderRow } from './team-records'

// ------------------------------------------------------------------ the actor

/** The door a CMF step came through. */
export type CmfDoor = 'mcp' | 'web'

/**
 * Who asks. On the web: the signed-in profile (`credentialId` null, every model allowed). Through
 * Claude: the MCP credential's owner, that credential and the models its token allows. `role` and
 * `email` are what the door knows; the gate never trusts them and reads the profile afresh.
 */
export interface CmfActor {
  profileId: string
  email: string | null
  role: string | null
  door: CmfDoor
  credentialId: string | null
  /** The token's model allowlist; empty or ['*'] allows every model. */
  allowedModels: string[]
}

// ------------------------------------------------------------------ what the service reaches

/** The kit CMF is read from: the product kit in production; any kit carrying CMF in the tests. */
export type LoadedKit = LoadedKitOf<AnyKit>

export interface CmfServiceDeps {
  loadKit(env: NodeJS.ProcessEnv): Promise<LoadedKit>
  readKitFile(loaded: LoadedKit, file: { path: string; sha256: string }): Promise<Buffer>
  ownerAccess(ownerId: string): Promise<{ admin: boolean; cmf: boolean }>
  pinRows(product: string): Promise<PinRow[]>
  pinBytes(path: string, env: NodeJS.ProcessEnv): Promise<Buffer | null>
  fetchPdf(url: string): Promise<Buffer>
  /** A CMF packet's exported PDF, when the caller may see the packet. */
  packetPdf(packetId: string, ownerId: string): Promise<{ url: string; name: string | null } | null>
  worker(env: NodeJS.ProcessEnv): WorkerConfig | null
  /** The web CMF Studio's workbook uploads: the import row, the stored bytes, the stored file's Last-Modified. */
  workbook: WorkbookSourceDeps
  /** The newest uploads that kept their file, for cmf_list. */
  recentImports(limit: number): Promise<WorkbookImportRow[]>
  /** Where a new workbook upload is kept: its import row, and its file at `cmf/{owner}/imports/{id}.xlsx`. */
  uploads: {
    create(input: { ownerId: string; fileName: string; tabs: Array<{ tab: string; skus: number }> }): Promise<{ id: string }>
    store(path: string, bytes: Buffer): Promise<void>
    setStoragePath(importId: string, path: string): Promise<void>
  }
  /** What cmf_pdf reaches beyond the kit and the upload. */
  pdf: Omit<CmfPdfDeps, 'loadWorkbook' | 'readKey' | 'clownBytes'>
  /** The picture under review: an output, a Frontify asset or a URL. */
  candidate(env: NodeJS.ProcessEnv): CandidateDeps
  /** Where grades and answers are kept (`creative_grades`, `creative_verdicts`). */
  records: CreativeRecordStore
  /** One CMF draw: the clown as the model's part, the model call, the file stored, its size, the clown's link. */
  draw: {
    clownPart(row: PinRow, spec: PinSpec, env: NodeJS.ProcessEnv, inlineLimit: number): Promise<GeminiPart>
    image(env: NodeJS.ProcessEnv, request: Parameters<typeof drawImage>[1]): Promise<{ bytes: Buffer; mimeType: string }>
    store(bytes: Buffer, mimeType: string, path: string): Promise<string>
    size(bytes: Buffer): Promise<{ width: number; height: number }>
    clownUrl(storagePath: string, env: NodeJS.ProcessEnv): Promise<string | null>
  }
  /** One CMF grade's reads: the candidate and the clown as parts, the model reads. */
  grader(env: NodeJS.ProcessEnv, inlineLimit: number, models: readonly string[]): Pick<GradeDeps, 'candidatePart' | 'pinPart' | 'read'>
  /** The CMF team's records: the team project every render is saved in, and the supplier PDFs. */
  team: CmfTeamStore
}

async function emailFromAuth(profileId: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const { data } = await createClient(url, key, { auth: { persistSession: false } }).auth.admin.getUserById(profileId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

export const productionCmfServiceDeps: CmfServiceDeps = {
  loadKit: (env) => getProductKit({ env }),
  readKitFile: (loaded, file) => readKitFile(loaded, file),
  async ownerAccess(ownerId) {
    const p = await prisma.profile.findUnique({ where: { id: ownerId }, select: { role: true, cmfAccess: true, pausedAt: true, deletedAt: true } })
    if (!p || p.pausedAt || p.deletedAt) return { admin: false, cmf: false }
    const admin = p.role === 'admin'
    return { admin, cmf: admin || p.cmfAccess === true }
  },
  pinRows: (product) => prismaPinStore.list(product),
  pinBytes: (path, env) => pinStorage(env).get(path),
  async fetchPdf(url) {
    const got = await fetchAllowlisted(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000, contentTypes: ['application/pdf', 'application/octet-stream'] })
    return got.buffer
  },
  async packetPdf(packetId, ownerId) {
    // The web app's own rule for who may see a packet; loaded here only, because the module
    // reads the request's cookies at import time.
    const { getPacketRole } = await import('@/lib/cmf/service')
    const role = await getPacketRole(packetId, ownerId)
    if (!role) return null
    const packet = await prisma.cmfPacket.findUnique({ where: { id: packetId }, select: { pdfUrl: true, name: true } })
    if (!packet?.pdfUrl) return null
    return { url: packet.pdfUrl, name: packet.name ?? null }
  },
  worker: (env) => workerConfigFromEnv(env),
  workbook: {
    importRow: (importId) =>
      prisma.cmfImport.findUnique({ where: { id: importId }, select: { id: true, ownerId: true, fileName: true, storagePath: true, createdAt: true } }),
    async bytes(storagePath) {
      const { downloadFromStorage } = await import('@/lib/supabase/storage')
      return downloadFromStorage(CMF_STORAGE_BUCKET, storagePath)
    },
    async storedLastModified(storagePath) {
      const { storageObjectLastModified } = await import('@/lib/supabase/storage')
      return storageObjectLastModified(CMF_STORAGE_BUCKET, storagePath)
    },
  },
  recentImports: (limit) =>
    prisma.cmfImport.findMany({
      where: { storagePath: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, ownerId: true, fileName: true, storagePath: true, createdAt: true },
    }),
  uploads: {
    async create(input) {
      const skus = input.tabs.reduce((n, t) => n + t.skus, 0)
      const row = await prisma.cmfImport.create({
        data: {
          ownerId: input.ownerId,
          fileName: input.fileName,
          // Read by the CMF engine's parse (workbook.ts) from the stored file whenever it is used;
          // the row keeps only what the upload held, for the record.
          rawRows: { reader: 'cmf-engine', tabs: input.tabs } as object,
          status: 'parsed',
          rowCount: skus,
        },
        select: { id: true },
      })
      return { id: row.id }
    },
    async store(path, bytes) {
      const { uploadBase64ToStorage } = await import('@/lib/supabase/storage')
      await uploadBase64ToStorage(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytes.toString('base64')}`, CMF_STORAGE_BUCKET, path)
    },
    async setStoragePath(importId, path) {
      await prisma.cmfImport.update({ where: { id: importId }, data: { storagePath: path } })
    },
  },
  pdf: {
    async renderOutput(outputId) {
      const out = await prisma.output.findUnique({
        where: { id: outputId },
        select: { id: true, fileUrl: true, generationId: true, generation: { select: { userId: true, parameters: true } } },
      })
      if (!out) return null
      return { id: out.id, fileUrl: out.fileUrl, generationId: out.generationId, ownerId: out.generation.userId, parameters: (out.generation.parameters ?? null) as Record<string, unknown> | null } satisfies RenderOutputRow
    },
    async webAttempt(id) {
      return !!(await prisma.cmfRenderAttempt.findUnique({ where: { id }, select: { id: true } }))
    },
    async verdicts(outputId, product) {
      const rows = await prisma.creativeVerdict.findMany({
        where: { outputId, product },
        orderBy: { createdAt: 'desc' },
        select: { id: true, profileId: true, credentialId: true, answer: true, remark: true, createdAt: true },
      })
      return rows satisfies VerdictRow[]
    },
    async verdictEmail(v) {
      if (v.credentialId) {
        const cred = await prisma.headlessCredential.findUnique({ where: { id: v.credentialId }, select: { subjectEmail: true } }).catch(() => null)
        if (cred?.subjectEmail) return cred.subjectEmail
      }
      return emailFromAuth(v.profileId)
    },
    async imageBytes(url) {
      const got = await fetchAllowlisted(url, { maxBytes: 40 * 1024 * 1024, timeoutMs: 30_000, contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'] })
      return { bytes: got.buffer, mimeType: got.contentType ?? null } satisfies SupplierPdfImage
    },
    async storePdf(path, bytes) {
      const { uploadBase64ToStorage } = await import('@/lib/supabase/storage')
      return uploadBase64ToStorage(`data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`, CMF_STORAGE_BUCKET, path)
    },
    now: () => new Date(),
  },
  candidate: (env) => productionCandidateDeps(env),
  records: prismaCreativeRecords,
  draw: {
    clownPart: (row, spec, env, inlineLimit) => pinPart(row, spec, pinPartDeps(env, inlineLimit)),
    image: (env, request) => drawImage(geminiDeps(env), request),
    store: (bytes, mimeType, path) => storeDrawn(bytes, mimeType, path),
    size: (bytes) => imageSize(bytes),
    clownUrl: (storagePath, env) => anchorUrl(storagePath, env),
  },
  grader(env, inlineLimit, models) {
    const partDeps = pinPartDeps(env, inlineLimit)
    return {
      candidatePart: (c) => candidatePartFor(env, inlineLimit, c),
      pinPart: (row, spec) => pinPart(row, spec, partDeps),
      read: gradeReader(env, models),
    }
  },
  team: prismaCmfTeamStore,
}

let deps: CmfServiceDeps = productionCmfServiceDeps

/** Tests swap what the service reaches for fixtures; null puts production back. */
export function setCmfServiceDeps(next: Partial<CmfServiceDeps> | null): void {
  deps = next ? { ...productionCmfServiceDeps, ...next } : productionCmfServiceDeps
}

// ------------------------------------------------------------------ the gate

export class CmfAccessError extends Error {
  constructor() {
    super('CMF files need CMF access on your Vesper profile (an admin turns it on under Users). Nothing was read.')
    this.name = 'CmfAccessError'
  }
}

/** The one gate: CMF access on the profile, or an admin, read fresh. Throws CmfAccessError. */
export async function requireCmf(actor: Pick<CmfActor, 'profileId'>): Promise<{ admin: boolean }> {
  const access = await deps.ownerAccess(actor.profileId)
  if (!access.cmf) throw new CmfAccessError()
  return { admin: access.admin }
}

/** The same gate by profile id alone. */
export async function assertCmfAccess(ownerId: string): Promise<void> {
  await requireCmf({ profileId: ownerId })
}

async function loadCmf(env: NodeJS.ProcessEnv): Promise<{ loaded: LoadedKit; cmf: CmfKit }> {
  const loaded = await deps.loadKit(env)
  return { loaded, cmf: cmfKit(loaded.kit) }
}

/**
 * Claude names things; it never hands Vesper a value. Every CMF step that reads a workbook upload
 * takes identifiers only (an import id, a tab, a column letter, a clown key, an output id) and
 * refuses any other argument, before it reads anything.
 */
export function identifiersOnly(tool: string, args: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(args ?? {}).filter((k) => !allowed.includes(k))
  if (extra.length) {
    throw new Error(
      `${tool} takes identifiers only (${allowed.join(', ')}) and refuses ${extra.join(', ')}: every value comes from the stored workbook's cells, never from Claude. Nothing was read.`
    )
  }
}

/** The payload for one SKU of a workbook upload, built by code, through one key of the kit. */
async function workbookPayload(loaded: LoadedKit, cmf: CmfKit, a: { import_id: string; tab: string; sku_column: string; clown: string }) {
  const wb = await loadStoredWorkbook(deps.workbook, a.import_id)
  const built = await buildWorkbookPayload({ cmf, wb, tab: a.tab, column: a.sku_column, keyId: a.clown, readKey: (entry) => deps.readKitFile(loaded, { path: entry.path, sha256: entry.sha256 }) })
  return { wb, ...built }
}

export type CmfWorkbookBuilt = Awaited<ReturnType<typeof workbookPayload>>

const parsedParts = new Map<string, CmfGradingParts>()

/** `kit/cmf-grading.json` at the kit's commit, checked by sha256; kept per sha. */
export async function cmfGradingParts(loaded: LoadedKit, cmf: CmfKit, read: CmfServiceDeps['readKitFile'] = deps.readKitFile): Promise<CmfGradingParts> {
  const file = cmf.product.grading_prompt?.parts_file
  if (!file) throw new CmfError(`the kit ${loaded.kit.tag} carries no CMF grading parts`)
  const hit = parsedParts.get(file.sha256)
  if (hit) return hit
  const parts = JSON.parse((await read(loaded, file)).toString('utf8')) as CmfGradingParts
  parsedParts.set(file.sha256, parts)
  return parts
}

// ------------------------------------------------------------------ listCmf

export interface CmfListedTab {
  tab: string | null
  slug: string
  vesper_product: string | null
  skus: Array<{ column: string; header?: string | null; name?: string | null; in_scope: boolean; scope_reason?: string | null }>
  keys: Array<{ id: string; clown: string | null; draft: boolean; confirmed: boolean }>
  payloads: Array<{ id: string; column: string; sku_name: string | null; key: string; status: string; key_confirmed: boolean | null; reasons: string[] }>
}

/** A CMF render of the team's, from either door, with its newest grade and the answers on it. */
export interface CmfTeamRender {
  output_id: string
  generation_id: string
  url: string
  made_at: string
  made_by: string | null
  door: CmfDoor | null
  tab: string | null
  column: string | null
  sku_name: string | null
  key: string | null
  lane: string | null
  model: string | null
  kit_tag: string | null
  import_id: string | null
  grade: { grade_id: string; verdict: string; judge: string; judge_model: string | null; reads: number; at: string } | null
  /** Every answer on it, newest first; `decider` when the kit names the person as its CMF decider. */
  answers: Array<{ answer: string; remark: string | null; by: string | null; decider: boolean; at: string }>
  /** The newest answer of a decider the kit names: the one a supplier PDF counts. */
  decider_answer: { answer: string; remark: string | null; by: string; at: string } | null
  /** Whether cmf_pdf would take it as far as the render goes (the upload's cells are checked when it runs). */
  pdf_eligible: boolean
  pdf_why: string | null
}

/** A supplier PDF of the team's, from either door. */
export interface CmfListedPdf {
  supplier_pdf_id: string
  file: string
  url: string
  tab: string
  columns: string[]
  output_ids: string[]
  import_id: string
  key: string
  made_by: string | null
  door: CmfDoor
  made_at: string
}

export interface CmfListing {
  loaded: LoadedKit
  cmf: CmfKit
  tabs: CmfListedTab[]
  uploads: Array<{ import_id: string; file: string; uploaded_at: string }>
  /** The team's newest CMF renders, from Claude and from the web, newest first. */
  renders: CmfTeamRender[]
  /** The team's newest supplier PDFs, newest first. */
  supplier_pdfs: CmfListedPdf[]
  /** What could not be read, said plainly; the rest of the listing stands. */
  problems: string[]
}

export const TEAM_RENDERS_LISTED = 10
export const SUPPLIER_PDFS_LISTED = 5

type Json = Record<string, unknown>

function creativeOf(parameters: unknown): Json {
  const p = (parameters && typeof parameters === 'object' ? parameters : {}) as Json
  return (p.creative && typeof p.creative === 'object' ? p.creative : {}) as Json
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Why cmf_pdf would refuse a render before it reads the upload, or null when it would take it:
 * the same rules as `runCmfPdf`.
 */
function pdfWhy(cmf: CmfKit, parameters: unknown, deciders: Array<{ name: string }>, deciderAnswer: CmfTeamRender['decider_answer']): string | null {
  if (!isCmfRender(parameters) || !engineDoor(parameters)) return 'not a CMF render made by the CMF engine'
  const c = creativeOf(parameters)
  const wb = c.workbook as Json | undefined
  if (!wb || !wb.sku_spec) return "made from the kit's saved copy of the sheet, not from a workbook upload"
  if (!deciders.length) return "the product kit names no CMF decider's email"
  if (!deciderAnswer) return `no answer from ${deciders.map((d) => d.name).join(' or ')} yet`
  if (deciderAnswer.answer !== 'yes') return `${deciderAnswer.by}'s latest answer is ${deciderAnswer.answer}${deciderAnswer.remark ? `: "${deciderAnswer.remark}"` : ''}`
  const keyId = str(c.key)
  const key = keyId ? cmf.keys[keyId] : undefined
  if (!key) return `its clown key '${keyId ?? '?'}' is not in this kit any more`
  const keySha = str(c.key_sha256)
  if (keySha && key.sha256 !== keySha) return `its clown key '${keyId}' changed since it was made`
  if (key.draft) return `its clown key '${keyId}' is a draft`
  if (!key.confirmed) return `its clown key '${keyId}' is not confirmed by Damien`
  return null
}

/** The door a render was made through, when the CMF engine made it. */
function engineDoor(parameters: unknown): CmfDoor | null {
  const source = ((parameters ?? {}) as Json).source
  return source === 'mcp' || source === 'web' ? source : null
}

/**
 * The team's newest renders and supplier PDFs, read only; a part that cannot be read is named, not
 * fatal. Membership of the team project is kept when someone renders, never by a listing.
 */
async function teamListing(cmf: CmfKit): Promise<Pick<CmfListing, 'renders' | 'supplier_pdfs' | 'problems'>> {
  const problems: string[] = []
  const deciders = deciderEmails(cmf)
  let rows: TeamRenderRow[] = []
  try {
    const project = await deps.team.findTeamProject()
    if (project) rows = await deps.team.recentRenders(project.id, TEAM_RENDERS_LISTED)
  } catch (err) {
    problems.push(`the team's renders could not be read (${(err as Error)?.message || 'unknown error'})`)
  }
  let pdfs: SupplierPdfRecord[] = []
  try {
    pdfs = await deps.team.recentSupplierPdfs(SUPPLIER_PDFS_LISTED)
  } catch (err) {
    problems.push(`the supplier PDFs could not be read (${(err as Error)?.message || 'unknown error'})`)
  }
  const emails = new Map<string, Promise<string | null>>()
  const emailOf = (v: VerdictRow) => {
    const k = `${v.profileId}|${v.credentialId ?? ''}`
    if (!emails.has(k)) emails.set(k, deps.pdf.verdictEmail(v).catch(() => null))
    return emails.get(k)!
  }
  const answersOf = new Map<string, VerdictRow[]>()
  for (const r of rows) {
    try {
      answersOf.set(r.outputId, await deps.pdf.verdicts(r.outputId, cmf.slug))
    } catch (err) {
      answersOf.set(r.outputId, [])
      problems.push(`the answers on ${r.outputId} could not be read (${(err as Error)?.message || 'unknown error'})`)
    }
  }
  const people = new Set<string>([...pdfs.map((x) => x.madeBy), ...Array.from(answersOf.values()).flat().map((v) => v.profileId)])
  const names = await deps.team.profileNames(Array.from(people)).catch(() => new Map<string, string | null>())
  const renders: CmfTeamRender[] = []
  for (const r of rows) {
    const c = creativeOf(r.parameters)
    const grade = await deps.records.latestGrade({ product: cmf.slug, outputId: r.outputId }).catch(() => null)
    const answers: CmfTeamRender['answers'] = []
    let deciderAnswer: CmfTeamRender['decider_answer'] = null
    for (const v of answersOf.get(r.outputId) ?? []) {
      const email = ((await emailOf(v)) ?? '').trim().toLowerCase()
      const d = deciders.find((x) => x.email === email)
      answers.push({ answer: v.answer, remark: v.remark, by: d?.name ?? names.get(v.profileId) ?? null, decider: !!d, at: v.createdAt.toISOString() })
      if (d && !deciderAnswer) deciderAnswer = { answer: v.answer, remark: v.remark, by: d.name, at: v.createdAt.toISOString() }
    }
    const why = pdfWhy(cmf, r.parameters, deciders, deciderAnswer)
    renders.push({
      output_id: r.outputId,
      generation_id: r.generationId,
      url: r.fileUrl,
      made_at: r.createdAt.toISOString(),
      made_by: r.makerName,
      door: engineDoor(r.parameters),
      tab: str(c.tab),
      column: str(c.column),
      sku_name: str(c.sku_name),
      key: str(c.key),
      lane: str(c.lane),
      model: str(c.model),
      kit_tag: str(c.kit_tag),
      import_id: str((c.workbook as Json | undefined)?.import_id),
      grade: grade
        ? { grade_id: grade.id, verdict: grade.verdict, judge: grade.judge, judge_model: grade.judgeModel, reads: grade.reads, at: grade.createdAt.toISOString() }
        : null,
      answers,
      decider_answer: deciderAnswer,
      pdf_eligible: why === null,
      pdf_why: why,
    })
  }
  const supplier_pdfs: CmfListedPdf[] = pdfs.map((x) => ({
    supplier_pdf_id: x.id,
    file: x.fileName,
    url: x.url,
    tab: x.tab,
    columns: x.skuColumns,
    output_ids: x.outputIds,
    import_id: x.importId,
    key: x.keyId,
    made_by: names.get(x.madeBy) ?? null,
    door: x.door,
    made_at: x.createdAt.toISOString(),
  }))
  return { renders, supplier_pdfs, problems }
}

/** The kit's tabs (one, when named), their SKUs, keys and prompts, and the newest uploads. */
export async function listCmf(actor: CmfActor, args: { tab?: string }, env: NodeJS.ProcessEnv = process.env): Promise<CmfListing> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  const parts = await cmfGradingParts(loaded, cmf)
  const tabs = args.tab ? [resolveTab(cmf, args.tab)] : Object.entries(cmf.specs).map(([slug, spec]) => ({ slug, spec }))
  const out: CmfListedTab[] = []
  for (const { slug, spec } of tabs) {
    const keys = keysForTab(cmf, spec).map(([id, k]) => ({ id, clown: k.clown?.id ?? null, draft: k.draft, confirmed: k.confirmed }))
    const payloads = Object.entries(cmf.payloads)
      .filter(([, p]) => p.spec === slug)
      .map(([id, p]) => ({ id, column: p.column, sku_name: p.sku_name, key: p.key, status: p.status, key_confirmed: p.key_confirmed ?? null, reasons: p.reasons ?? [] }))
    let skus: CmfListedTab['skus'] = inScopeColumns(parts, slug).map((c) => ({
      column: c.column,
      name: c.sku_name,
      in_scope: true,
    }))
    if (args.tab) {
      const specJson = JSON.parse((await deps.readKitFile(loaded, spec)).toString('utf8')) as Spec
      skus = specJson.skus.map((s) => ({ column: s.column, header: s.header ?? null, name: s.name ?? null, in_scope: s.in_scope === true, scope_reason: (s.scope_reason as string | undefined) ?? null }))
    }
    out.push({ tab: spec.tab, slug, vesper_product: spec.vesper_product, skus, keys, payloads })
  }
  const uploads = (await deps.recentImports(5).catch(() => [] as WorkbookImportRow[])).map((i) => ({ import_id: i.id, file: i.fileName, uploaded_at: i.createdAt.toISOString() }))
  return { loaded, cmf, tabs: out, uploads, ...(await teamListing(cmf)) }
}

// ------------------------------------------------------------------ uploadWorkbook, readUpload

/** One tab of an upload, as the CMF engine parses it, and the kit's keys for it. */
export interface CmfUploadTab {
  tab: string
  /** The kit's tab it is, or null when the kit has no such tab (nothing can be made from it). */
  slug: string | null
  vesper_product: string | null
  skus: Array<{ column: string; header: string | null; name: string | null; in_scope: boolean; scope_reason: string | null }>
  keys: CmfListedTab['keys']
}

/** A workbook upload: the file as Vesper keeps it, and every tab the engine read from it. */
export interface CmfUploadView {
  import_id: string
  file: string
  sha256: string | null
  modified: string | null
  modified_source: string | null
  imported_at: string
  tabs: CmfUploadTab[]
}

export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024

/**
 * An upload's tabs and SKUs by column letter, read by the parse cmf_prompt, cmf_render and cmf_pdf
 * read it with (`loadStoredWorkbook`), and each tab's keys with their state, as cmf_list gives them.
 */
export async function readUpload(actor: CmfActor, args: { import_id: string }, env: NodeJS.ProcessEnv = process.env): Promise<{ loaded: LoadedKit; upload: CmfUploadView }> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  const wb = await loadStoredWorkbook(deps.workbook, args.import_id)
  const tabs: CmfUploadTab[] = Object.entries(wb.specs).map(([title, spec]) => {
    let slug: string | null = null
    let kitSpec: CmfSpec | null = null
    try {
      const hit = resolveTab(cmf, title)
      slug = hit.slug
      kitSpec = hit.spec
    } catch {
      // A tab the kit does not know: listed, and nothing can be made from it.
    }
    return {
      tab: title,
      slug,
      vesper_product: kitSpec?.vesper_product ?? null,
      skus: spec.skus.map((x) => ({
        column: x.column,
        header: x.header ?? null,
        name: x.name ?? null,
        in_scope: x.in_scope === true,
        scope_reason: (x.scope_reason as string | undefined) ?? null,
      })),
      keys: kitSpec ? keysForTab(cmf, kitSpec).map(([id, k]) => ({ id, clown: k.clown?.id ?? null, draft: k.draft, confirmed: k.confirmed })) : [],
    }
  })
  return {
    loaded,
    upload: {
      import_id: wb.importId,
      file: wb.fileName,
      sha256: wb.info.sha256 ?? null,
      modified: wb.info.modified ?? null,
      modified_source: wb.info.modified_source ?? null,
      imported_at: wb.importedAt,
      tabs,
    },
  }
}

/**
 * A workbook export kept for the team: read by the CMF engine's parse first (a file it cannot read
 * is refused and nothing is kept), then its row and its file, then read back through the same path
 * every step reads an upload by (`readUpload`). Claude names it by the import id this returns.
 */
export async function uploadWorkbook(actor: CmfActor, args: { file_name: string; bytes: Buffer }, env: NodeJS.ProcessEnv = process.env): Promise<{ loaded: LoadedKit; upload: CmfUploadView }> {
  await requireCmf(actor)
  const name = args.file_name.trim() || 'workbook.xlsx'
  if (!/\.xlsx$/i.test(name)) throw new CmfError(`${name} is not an .xlsx workbook: upload the CMF workbook as exported (File, Download, Microsoft Excel). Nothing was kept.`)
  if (args.bytes.length > MAX_WORKBOOK_BYTES) throw new CmfError(`${name} is larger than ${MAX_WORKBOOK_BYTES / (1024 * 1024)} MB. Nothing was kept.`)
  let specs: ReturnType<typeof parseWorkbookBytes>
  try {
    specs = parseWorkbookBytes(args.bytes, workbookInfoForUpload({ bytes: args.bytes, fileName: name, storedLastModified: null }))
  } catch (err) {
    throw new CmfError(`${name} is not a workbook Vesper can read (${(err as Error)?.message || 'unknown error'}). Nothing was kept.`)
  }
  const tabs = Object.entries(specs).map(([tab, spec]) => ({ tab, skus: spec.skus.length }))
  if (!tabs.length) throw new CmfError(`${name} has no CMF tab Vesper can read. Nothing was kept.`)
  const { id } = await deps.uploads.create({ ownerId: actor.profileId, fileName: name, tabs })
  const path = importStoragePath(actor.profileId, id)
  try {
    await deps.uploads.store(path, args.bytes)
    await deps.uploads.setStoragePath(id, path)
  } catch (err) {
    throw new CmfError(`${name} could not be kept in Vesper's storage (${(err as Error)?.message || 'unknown error'}). Upload it again.`)
  }
  return readUpload(actor, { import_id: id }, env)
}

// ------------------------------------------------------------------ cmfKeys

/** A clown key of the kit, read only: its state, its clown, and whether Vesper holds the clown's pin. */
export interface CmfListedKey {
  id: string
  product: string | null
  variant: string | null
  draft: boolean
  confirmed: boolean
  /** The kit's tabs whose product the key is for. */
  tabs: string[]
  clown: { id: string; sha256: string; width: number | null; height: number | null } | null
  /** Whether the clown's pinned copy is in Vesper (a render refuses a clown that is not). */
  pinned: boolean
  /** A link to the pinned clown, when there is one. */
  clown_url: string | null
}

/** The kit's clown keys and their clowns, with their state. A key changes only in the product kit's repository. */
export async function cmfKeys(actor: CmfActor, env: NodeJS.ProcessEnv = process.env): Promise<{ loaded: LoadedKit; keys: CmfListedKey[] }> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  const specs = kitPins(loaded.kit).filter((p) => p.product === cmf.slug)
  const rows = await deps.pinRows(cmf.slug).catch(() => [] as PinRow[])
  const keys: CmfListedKey[] = []
  for (const [id, k] of Object.entries(cmf.keys).sort(([a], [b]) => a.localeCompare(b))) {
    const spec = k.clown ? specs.find((p) => p.pinId === k.clown!.id && p.sha256 === k.clown!.sha256) : undefined
    const row = spec ? rows.find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256) : undefined
    const pinned = !!(spec && row && usablePin(row, spec) && row.storagePath)
    const clown_url = pinned && row?.storagePath ? await deps.draw.clownUrl(row.storagePath, env).catch(() => null) : null
    keys.push({
      id,
      product: k.product,
      variant: k.variant,
      draft: k.draft,
      confirmed: k.confirmed,
      tabs: Object.values(cmf.specs)
        .filter((x) => !!x.vesper_product && x.vesper_product === k.product)
        .map((x) => x.tab ?? '')
        .filter(Boolean),
      clown: k.clown ? { id: k.clown.id, sha256: k.clown.sha256, width: k.clown.width ?? null, height: k.clown.height ?? null } : null,
      pinned,
      clown_url,
    })
  }
  return { loaded, keys }
}

// ------------------------------------------------------------------ cmfPrompt

/** The kit's pre-built payload for a tab, column and key. */
export interface CmfKitTarget {
  tab: string
  column: string
  clown: string
}

/** One SKU of a workbook upload, by identifiers only. */
export interface CmfUploadTarget {
  import_id: string
  tab: string
  sku_column: string
  clown: string
}

function isUploadTarget(t: CmfKitTarget | CmfUploadTarget): t is CmfUploadTarget {
  return typeof (t as CmfUploadTarget).import_id === 'string'
}

async function readPayload(loaded: LoadedKit, cmf: CmfKit, tab: string, column: string, clown: string) {
  const { slug, spec } = resolveTab(cmf, tab)
  resolveKey(cmf, spec, clown)
  const entry = payloadFor(cmf, slug, column.toUpperCase(), clown)
  if (entry.status !== 'ready' || !entry.path || !entry.sha256) return { slug, spec, entry, payload: null as CmfPayload | null, bytes: null as Buffer | null }
  const bytes = await deps.readKitFile(loaded, { path: entry.path, sha256: entry.sha256 })
  return { slug, spec, entry, payload: JSON.parse(bytes.toString('utf8')) as CmfPayload, bytes }
}

export type CmfPromptOutcome =
  | { source: 'upload'; loaded: LoadedKit; built: CmfWorkbookBuilt }
  | { source: 'upload'; loaded: LoadedKit; refused: PromptRefusal; target: CmfUploadTarget }
  | { source: 'kit'; loaded: LoadedKit; entry: CmfPayloadEntry; spec: CmfSpec; payload: CmfPayload | null }

/** Damien's template filled by code: from an upload's cells, or the payload the kit pre-built; or the refusal. */
export async function cmfPrompt(actor: CmfActor, target: CmfKitTarget | CmfUploadTarget, env: NodeJS.ProcessEnv = process.env): Promise<CmfPromptOutcome> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  if (isUploadTarget(target)) {
    try {
      return { source: 'upload', loaded, built: await workbookPayload(loaded, cmf, target) }
    } catch (err) {
      if (err instanceof PromptRefusal) return { source: 'upload', loaded, refused: err, target }
      throw err
    }
  }
  const { entry, spec, payload } = await readPayload(loaded, cmf, target.tab, target.column, target.clown)
  return { source: 'kit', loaded, entry, spec, payload }
}

// ------------------------------------------------------------------ planRender, runRender

export interface CmfRenderOptions {
  lane?: CmfLane
  n?: number
  image_size?: '1K' | '2K' | '4K'
}

export type CmfRenderTarget = (CmfKitTarget | CmfUploadTarget) & CmfRenderOptions

/** A render that passed every refusal: the plan, and the clown's pin, its bytes already checked. */
export interface CmfRenderReady {
  loaded: LoadedKit
  cmf: CmfKit
  plan: CmfRenderPlan
  clown: { row: PinRow; spec: PinSpec }
}

export interface CmfRenderExecution {
  header: ReturnType<typeof kitHeader>
  plan: CmfRenderPlan
  generationId: string
  outputs: Array<{ url: string; width: number; height: number; mimeType: string; outputId: string | null }>
  previewSources: string[]
  manifest: Record<string, unknown>[]
  failures: string[]
  recorded: boolean
  recordError: string | null
  costUsd: number | null
}

/** The clown's pin for a plan, its bytes checked against the payload before anything is paid for. */
async function clownForRender(env: NodeJS.ProcessEnv, loaded: LoadedKit, cmf: CmfKit, plan: CmfRenderPlan): Promise<{ row: PinRow; spec: PinSpec }> {
  const spec = kitPins(loaded.kit).find((s) => s.product === cmf.slug && s.pinId === plan.clown.id && s.sha256 === plan.clown.sha256)
  if (!spec) throw new CmfError(`the clown ${plan.clown.id} with the payload's sha256 is not a pin in the kit: the clown changed; its key must be sampled again`)
  const row = (await deps.pinRows(cmf.slug)).find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256)
  if (!row || !usablePin(row, spec) || !row.storagePath) {
    throw new CmfError(`the clown ${plan.clown.id} is not pinned in Vesper yet (an admin syncs the pins). Nothing was paid for.`)
  }
  const bytes = await deps.pinBytes(row.storagePath, env)
  if (!bytes) throw new CmfError(`the clown ${plan.clown.id}'s pinned copy could not be read. Nothing was paid for.`)
  checkClownBytes(plan, bytes)
  return { row, spec }
}

/**
 * Every refusal `render.py` makes, before anything is paid for: the payload (built from the
 * upload's cells, or the kit's), the plan, the model the actor may use, and the clown's pinned
 * bytes against the payload.
 */
export async function planRender(actor: CmfActor, target: CmfRenderTarget, env: NodeJS.ProcessEnv = process.env): Promise<CmfRenderReady> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  const options = { lane: target.lane, n: target.n, image_size: target.image_size }
  let plan: CmfRenderPlan
  if (isUploadTarget(target)) {
    let built: CmfWorkbookBuilt
    try {
      built = await workbookPayload(loaded, cmf, target)
    } catch (err) {
      if (err instanceof PromptRefusal) throw new CmfError(`not sent (nothing was paid for): ${err.reasons.join('; ')}`)
      throw err
    }
    plan = planCmfRenderFromWorkbook(cmf, built.payload, built.payloadId, target.clown, options)
  } else {
    const { entry, bytes } = await readPayload(loaded, cmf, target.tab, target.column, target.clown)
    if (!bytes) throw new CmfError(`no prompt for ${entry.tab} column ${entry.column} through '${entry.key}': ${(entry.reasons ?? []).join('; ') || 'refused'}`)
    plan = planCmfRender(cmf, entry, bytes, options)
  }
  assertModelAllowed(actor.allowedModels, vesperModelId(plan.model))
  const clown = await clownForRender(env, loaded, cmf, plan)
  return { loaded, cmf, plan, clown }
}

/**
 * What a CMF render records about itself on its generation (`parameters.creative`). From a workbook
 * upload it also records the upload, the workbook's sha256, the SKU's cells as parsed and the
 * key's sha256: cmf_pdf reads them back to hold the render to the workbook.
 */
export function cmfRenderCreative(plan: CmfRenderPlan, header: Pick<ReturnType<typeof kitHeader>, 'kit_version' | 'kit_tag' | 'kit_commit'>): Record<string, unknown> {
  return {
    product: 'cmf',
    tab: plan.tab,
    column: plan.column,
    sku_name: plan.skuName,
    key: plan.key,
    key_confirmed: plan.keyConfirmed,
    lane: plan.lane,
    model: plan.model,
    kit_version: header.kit_version,
    kit_tag: header.kit_tag,
    kit_commit: header.kit_commit,
    payload: { id: plan.payloadId, prompt_sha256: plan.promptSha256, clown: plan.clown },
    ...(plan.workbook ? { key_sha256: plan.keySha256, workbook: plan.workbook } : {}),
  }
}

/** Where a door's drawn files are stored: the MCP credential's folder, or the web profile's. */
function drawFolder(actor: CmfActor): string {
  return actor.door === 'mcp' ? `mcp/${actor.credentialId}` : `web/${actor.profileId}`
}

/** The draws of a ready render, one model call per image, stored and recorded. */
export async function runRender(actor: CmfActor, ready: CmfRenderReady, opts: { jobId: string | null }, env: NodeJS.ProcessEnv = process.env): Promise<CmfRenderExecution> {
  const { loaded, cmf, plan, clown } = ready
  const header = kitHeader(loaded)
  const inlineLimit = cmf.product.grading?.inline_limit_bytes ?? 3_500_000
  const part: GeminiPart = await deps.draw.clownPart(clown.row, clown.spec, env, inlineLimit)
  const { images, failures } = await executeCmfDraws(plan, async (_index, deadline) => {
    const img = await deps.draw.image(env, { ...cmfDrawRequest(plan, part), deadline })
    return { ...img, model: plan.model, settings: { aspectRatio: plan.aspect, imageSize: plan.imageSize } } as Omit<CmfDrawn, 'index'>
  })
  const generationId = randomUUID()
  const stored = await Promise.all(
    images.map(async (img) => {
      const ext = img.mimeType === 'image/jpeg' ? 'jpg' : img.mimeType === 'image/webp' ? 'webp' : 'png'
      const url = await deps.draw.store(img.bytes, img.mimeType, `${drawFolder(actor)}/${generationId}/${img.index - 1}.${ext}`)
      return { img, url, ...(await deps.draw.size(img.bytes)) }
    })
  )
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const manifest = stored.map((s) => cmfManifestLine(plan, { index: s.img.index, file: s.url, model: s.img.model, settings: s.img.settings, timestamp }))
  const perImage = drawPriceUsd(plan.model, plan.imageSize)
  const costUsd = perImage === null ? null : perImage * stored.length
  const clownUrl = clown.row.storagePath ? await deps.draw.clownUrl(clown.row.storagePath, env).catch(() => null) : null
  let outputIds: Array<string | null> = stored.map(() => null)
  let recorded = false
  let recordError: string | null = null
  try {
    // In the CMF team's project, whichever door: the same `parameters.creative`, the door named.
    const result = await recordCmfRender(
      {
        ownerId: actor.profileId,
        generationId,
        source: actor.door,
        modelId: vesperModelId(plan.model),
        prompt: plan.prompt,
        costUsd,
        outputs: stored.map((s) => ({ url: s.url, width: s.width || null, height: s.height || null })),
        parameters: {
          toolName: 'cmf_render',
          source: actor.door,
          credentialId: actor.credentialId,
          mcpJobId: opts.jobId,
          creative: cmfRenderCreative(plan, header),
          manifest,
          aspectRatio: plan.aspect,
          imageSize: plan.imageSize,
          numOutputs: stored.length,
          ...(clownUrl ? { anchor: { kind: 'clown', id: plan.clown.id, url: clownUrl, sha256: plan.clown.sha256 } } : {}),
          estimatedCostUsd: costUsd,
        },
      },
      deps.team
    )
    outputIds = result.outputIds
    recorded = true
  } catch (err) {
    recordError = (err as Error)?.message || 'unknown error'
  }
  return {
    header,
    plan,
    generationId,
    outputs: stored.map((s, i) => ({ url: s.url, width: s.width, height: s.height, mimeType: s.img.mimeType, outputId: outputIds[i] ?? null })),
    previewSources: stored.map((s) => `data:${s.img.mimeType};base64,${s.img.bytes.toString('base64')}`),
    manifest,
    failures,
    recorded,
    recordError,
    costUsd,
  }
}

// ------------------------------------------------------------------ planGrade, runGrade

/**
 * A CMF render to grade: its sheet row and clown key, and the picture. With `import_id` the row is
 * that upload's, built by code from the same parse the prompt was filled from; a render made from
 * an upload records which, and its tab, column and key, so those may be left out. Without it the
 * row is the kit's committed one, as before.
 */
export interface CmfGradeTarget {
  /** The product kit, when the door has already read it (grade_image resolves the product first). */
  loaded?: LoadedKit
  tab?: string
  column?: string
  clown?: string
  import_id?: string
  output_id?: string
  frontify_asset_id?: string
  image_url?: string
  runs?: number
}

export interface CmfGradeReady {
  loaded: LoadedKit
  cmf: CmfKit
  parts: CmfGradingParts
  target: { spec: string; column: string; key: string; tab: string; sku_name: string | null; import_id?: string; workbook_sha256?: string | null }
  picture: Pick<CmfGradeTarget, 'output_id' | 'frontify_asset_id' | 'image_url'>
  runs?: number
}

export interface CmfGradeExecution {
  header: ReturnType<typeof kitHeader>
  slug: string
  product: KitProduct
  candidate: Omit<LoadedCandidate, 'bytes'>
  outcome: GradeOutcome
  gradeId: string | null
  storeError: string | null
  costUsd: number
  cmf: CmfGradeReady['target']
}

/** The gate, the tab, column and key against the kit (or the upload), before any read is paid for. */
export async function planGrade(actor: CmfActor, t: CmfGradeTarget, env: NodeJS.ProcessEnv = process.env): Promise<CmfGradeReady> {
  await requireCmf(actor)
  const loaded = t.loaded ?? (await deps.loadKit(env))
  const cmf = cmfKit(loaded.kit)
  const picture = { output_id: t.output_id, frontify_asset_id: t.frontify_asset_id, image_url: t.image_url }
  if (t.import_id) return planUploadGrade(loaded, cmf, t, picture)
  if (!t.tab || !t.column || !t.clown) {
    throw new CmfError('a CMF render is graded against its sheet row and its clown: name the tab, the column and the clown key (cmf_list names them)')
  }
  const { slug: specSlug } = resolveTab(cmf, t.tab)
  const column = t.column.toUpperCase()
  const parts = await cmfGradingParts(loaded, cmf)
  const { tab, skuName } = checkCmfTarget(cmf, parts, specSlug, column, t.clown)
  const target = { spec: specSlug, column, key: t.clown, tab, sku_name: skuName }
  return { loaded, cmf, parts, target, picture, runs: t.runs }
}

const fold = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase()

/** The kit's owned Pantone lookup (`pantone.json`'s codes), read by sha256; none when the kit names none. */
async function pantoneOf(loaded: LoadedKit, cmf: CmfKit): Promise<PantoneLookup> {
  const file = (cmf.product as Record<string, unknown>).pantone as { path?: string; sha256?: string } | undefined
  if (!file?.path || !file.sha256) return {}
  const json = JSON.parse((await deps.readKitFile(loaded, { path: file.path, sha256: file.sha256 })).toString('utf8')) as { codes?: PantoneLookup }
  return json.codes ?? {}
}

/**
 * A grade against an upload's row: the tab, column and key the render records (or the ones named),
 * the row and the key built by code from the upload (`grading-row.ts`), and the render's recorded
 * cells held to that row, so a render is never graded against cells it was not made from.
 */
async function planUploadGrade(loaded: LoadedKit, cmf: CmfKit, t: CmfGradeTarget, picture: CmfGradeReady['picture']): Promise<CmfGradeReady> {
  const importId = t.import_id!
  let tab = t.tab ?? null
  let column = t.column ?? null
  let clown = t.clown ?? null
  let recordedCells: SkuSpecView | null = null
  if (t.output_id) {
    const render = await deps.pdf.renderOutput(t.output_id)
    if (render && isCmfRender(render.parameters)) {
      const c = creativeOf(render.parameters)
      const wb = (c.workbook ?? null) as Json | null
      const from = str(wb?.import_id)
      if (from && from !== importId) {
        throw new CmfError(`output ${t.output_id} was rendered from upload ${from}, not ${importId}: grade it against the upload it was made from (import_id ${from})`)
      }
      // A tab may be named by its sheet name or its slug; both name one tab of the kit.
      const tabOf = (q: string) => {
        try {
          return resolveTab(cmf, q).slug
        } catch {
          return fold(q)
        }
      }
      const recorded: Array<[string, string | null, string | null, (q: string) => string]> = [
        ['tab', tab, str(c.tab), tabOf],
        ['column', column, str(c.column), fold],
        ['clown', clown, str(c.key), fold],
      ]
      for (const [name, given, rec, same] of recorded) {
        if (given && rec && same(given) !== same(rec)) {
          throw new CmfError(`output ${t.output_id} is a render of ${str(c.tab)} column ${str(c.column)} through ${str(c.key)}; the ${name} named (${given}) is not its own. Leave it out, or name the render's.`)
        }
      }
      tab = tab ?? str(c.tab)
      column = column ?? str(c.column)
      clown = clown ?? str(c.key)
      recordedCells = (wb?.sku_spec ?? null) as SkuSpecView | null
    }
  }
  if (!tab || !column || !clown) {
    throw new CmfError(`name the tab, the column and the clown key to grade against upload ${importId}; only a CMF render made from an upload records them`)
  }
  const wbk = await loadStoredWorkbook(deps.workbook, importId)
  const { spec, kitSlug } = workbookTab(wbk, cmf, tab)
  const col = column.toUpperCase()
  const sku = spec.skus.find((s) => s.column === col)
  if (!sku) throw new CmfError(`${spec.tab} has no SKU column ${col}; its columns: ${spec.skus.map((s) => s.column).join(', ')}`)
  if (sku.in_scope !== true) throw new CmfError(`${spec.tab} column ${col} is not in scope (${String(sku.scope_reason ?? 'no Product Name')}), so there is no row to grade a render against`)
  const keyEntry = resolveKey(cmf, cmf.specs[kitSlug], clown)
  if (recordedCells) {
    const changes = skuSpecChanges(recordedCells, skuSpecView(spec, col))
    if (changes.length) {
      throw new CmfError(
        [
          `output ${t.output_id} was rendered from cells that are not upload ${importId}'s row now, so it is not graded against it:`,
          ...changes.slice(0, 12).map((c) => `- ${c.component} · ${c.field} (${c.cell ?? '?'}): rendered from ${JSON.stringify(c.rendered ?? '')}, the upload holds ${JSON.stringify(c.now ?? '')}`),
          ...(changes.length > 12 ? [`(${changes.length - 12} more)`] : []),
        ].join('\n')
      )
    }
  }
  const keyFile = JSON.parse((await deps.readKitFile(loaded, { path: keyEntry.path, sha256: keyEntry.sha256 })).toString('utf8')) as ClownKeyFile
  const kitParts = await cmfGradingParts(loaded, cmf)
  const parts = gradingPartsFor({ spec, specSlug: kitSlug, column: col, keyId: clown, key: keyFile, pantone: await pantoneOf(loaded, cmf), noKeyLines: kitParts.no_key_lines })
  const { tab: tabName, skuName } = checkCmfTarget(cmf, parts, kitSlug, col, clown)
  const target = { spec: kitSlug, column: col, key: clown, tab: tabName, sku_name: skuName, import_id: wbk.importId, workbook_sha256: wbk.info.sha256 ?? null }
  return { loaded, cmf, parts, target, picture, runs: t.runs }
}

/**
 * The picture under review for CMF: an output of the actor's own, as for every product, or any
 * CMF render of the team's, whoever made it, from either door.
 */
function teamCandidate(env: NodeJS.ProcessEnv): CandidateDeps {
  const base = deps.candidate(env)
  return {
    ...base,
    async findOwnOutput(outputId, ownerId) {
      const own = await base.findOwnOutput(outputId, ownerId)
      if (own) return own
      const render = await deps.pdf.renderOutput(outputId)
      return render && isCmfRender(render.parameters) ? { fileUrl: render.fileUrl, parameters: render.parameters } : null
    },
  }
}

/** Whether an output is a CMF render of the team's (the answer on it needs CMF access). */
export async function isCmfRenderOutput(outputId: string): Promise<boolean> {
  const render = await deps.pdf.renderOutput(outputId).catch(() => null)
  return !!render && isCmfRender(render.parameters)
}

/** Three reads of one render against its row and its clown, stored in `creative_grades`. */
export async function runGrade(actor: CmfActor, ready: CmfGradeReady, env: NodeJS.ProcessEnv = process.env): Promise<CmfGradeExecution> {
  const { loaded, cmf, parts, target } = ready
  const product = cmf.product
  const candidate = await loadCandidate(ready.picture, actor.profileId, teamCandidate(env))
  const rows = await deps.pinRows(cmf.slug)
  const inlineLimit = product.grading?.inline_limit_bytes ?? 3_500_000
  const outcome = await gradeCmfCandidate(
    { kit: loaded.kit, cmf, parts, candidate, spec: target.spec, column: target.column, key: target.key, runs: ready.runs },
    { pinRows: rows, ...deps.grader(env, inlineLimit, product.grading?.models ?? []) }
  )
  const header = kitHeader(loaded)
  const costUsd = GRADE_READ_USD * outcome.aggregate.reads
  let gradeId: string | null = null
  let storeError: string | null = null
  try {
    const stored = await deps.records.insertGrade({
      product: cmf.slug,
      ownerId: actor.profileId,
      credentialId: actor.credentialId,
      outputId: candidate.outputId,
      imageUrl: candidate.imageUrl,
      frontifyAssetId: candidate.frontifyAssetId,
      imageSha256: candidate.sha256,
      colourway: `${target.tab} ${target.column}${target.sku_name ? ` ${target.sku_name}` : ''}`,
      view: 'clown',
      viewAssumed: false,
      claimSource: null,
      judge: 'vesper',
      judgeModel: outcome.judge_model,
      reads: outcome.aggregate.reads,
      templateId: outcome.template_id,
      kitVersion: loaded.kit.version,
      kitCommit: loaded.commit,
      rubricVersion: product.rubric.version ?? '?',
      runs: outcome.reads,
      fails: outcome.aggregate.fails,
      failed: outcome.aggregate.failed,
      failedAdvisory: outcome.aggregate.failed_advisory,
      verdict: outcome.aggregate.verdict,
      verdictMajority: outcome.aggregate.verdict_majority,
      unstable: outcome.aggregate.unstable,
      errors: outcome.aggregate.errors,
      references: { attached: outcome.references, missing: outcome.missing, prompt_sha256: outcome.prompt_sha256, cmf: target },
      latencyMs: outcome.latency_ms,
      costUsd,
    })
    gradeId = stored.id
  } catch (err) {
    storeError = (err as Error)?.message || 'the grade could not be stored'
  }
  const { bytes: _bytes, ...rest } = candidate
  return { header, slug: cmf.slug, product, candidate: rest, outcome, gradeId, storeError, costUsd, cmf: target }
}

/** planGrade then runGrade, for a door that waits for the reads. */
export async function gradeRender(actor: CmfActor, t: CmfGradeTarget, env: NodeJS.ProcessEnv = process.env): Promise<CmfGradeExecution> {
  return runGrade(actor, await planGrade(actor, t, env), env)
}

// ------------------------------------------------------------------ recordCmfVerdict

export interface CmfVerdictInput {
  /** The product kit, when the door has already read it. */
  loaded?: LoadedKit
  grade_id?: string
  output_id?: string
  frontify_asset_id?: string
  image_url?: string
  answer: 'yes' | 'no'
  remark: string
  decoded: string[]
  decoded_unconfirmed: string[]
}

export interface CmfVerdictOutcome {
  loaded: LoadedKit
  slug: string
  verdictId: string
  grade: GradeRecord | null
  frontifyAssetId: string | null
  /** The kit's CMF decider this answer is from, by the email it was given under; null when it is someone else's. */
  decider: string | null
}

/**
 * A person's yes or no on one CMF render, in their name, against the render's latest grade (or
 * the one named). Recorded in Vesper (`creative_verdicts`): a CMF answer is never a Frontify
 * comment. The kit's decider rule is the supplier PDF's: only the latest answer of a person the
 * kit names as CMF decider, by the email the answer was given under, counts.
 */
export async function recordCmfVerdict(actor: CmfActor, v: CmfVerdictInput, env: NodeJS.ProcessEnv = process.env): Promise<CmfVerdictOutcome> {
  await requireCmf(actor)
  const loaded = v.loaded ?? (await deps.loadKit(env))
  const cmf = cmfKit(loaded.kit)
  const slug = cmf.slug
  const product = cmf.product
  const known = new Set(product.rubric.checks.map((c) => c.id))
  const unknown = [...v.decoded, ...v.decoded_unconfirmed].filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`${product.name}'s rubric has no check ${unknown.join(', ')}`)

  // The grade the answer responds to: the one named, else the newest of this picture.
  let grade: GradeRecord | null = null
  if (v.grade_id) {
    grade = await deps.records.getGrade(v.grade_id)
    if (!grade || grade.product !== slug) throw new Error(`no ${slug} grade '${v.grade_id}'`)
  }
  let imageSha256: string | null = grade?.imageSha256 ?? null
  if (!grade && v.image_url) {
    const candidate = await loadCandidate({ image_url: v.image_url }, actor.profileId, teamCandidate(env))
    imageSha256 = candidate.sha256
  }
  if (!grade) {
    grade = await deps.records.latestGrade({ product: slug, outputId: v.output_id ?? null, frontifyAssetId: v.frontify_asset_id ?? null, imageSha256 })
  }
  const frontifyAssetId = v.frontify_asset_id ?? grade?.frontifyAssetId ?? null
  const stored = await deps.records.insertVerdict({
    product: slug,
    profileId: actor.profileId,
    credentialId: actor.credentialId,
    gradeId: grade?.id ?? null,
    outputId: v.output_id ?? grade?.outputId ?? null,
    imageUrl: v.image_url ?? grade?.imageUrl ?? null,
    frontifyAssetId,
    imageSha256: imageSha256 ?? grade?.imageSha256 ?? null,
    answer: v.answer,
    remark: v.remark || null,
    decoded: v.decoded,
    decodedUnconfirmed: v.decoded_unconfirmed,
    route: 'vesper',
    commentLine: null,
    kitVersion: loaded.kit.version,
    rubricVersion: product.rubric.version,
  })
  return { loaded, slug, verdictId: stored.id, grade, frontifyAssetId, decider: await deciderOf(cmf, actor) }
}

/** The kit's CMF decider an answer from this actor would count as, or null. */
async function deciderOf(cmf: CmfKit, actor: CmfActor): Promise<string | null> {
  const deciders = deciderEmails(cmf)
  if (!deciders.length) return null
  const email = ((await deps.pdf.verdictEmail({ id: '', profileId: actor.profileId, credentialId: actor.credentialId, answer: '', remark: null, createdAt: new Date(0) }).catch(() => null)) ?? actor.email ?? '')
    .trim()
    .toLowerCase()
  return deciders.find((d) => d.email === email)?.name ?? null
}

// ------------------------------------------------------------------ supplierPdf

/** The pinned clown of a key, its bytes checked against the key's clown sha256. */
async function clownOfKey(env: NodeJS.ProcessEnv, loaded: LoadedKit, cmf: CmfKit, keyId: string): Promise<SupplierPdfImage | null> {
  const key = cmf.keys[keyId]
  if (!key?.clown) return null
  const spec = kitPins(loaded.kit).find((s) => s.product === cmf.slug && s.pinId === key.clown!.id && s.sha256 === key.clown!.sha256)
  if (!spec) return null
  const row = (await deps.pinRows(cmf.slug)).find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256)
  if (!row || !usablePin(row, spec) || !row.storagePath) return null
  const bytes = await deps.pinBytes(row.storagePath, env)
  if (!bytes || sha256Hex(bytes) !== key.clown.sha256) return null
  return { bytes, mimeType: 'image/png' }
}

export type CmfSupplierPdfOutcome =
  | { saved: true; loaded: LoadedKit; result: CmfPdfResult; listed: { id: string } | { error: string } }
  | { saved: false; loaded: LoadedKit; refused: CmfPdfRefused }

/**
 * The supplier PDF from one upload and one approved render per SKU column (`supplier-pdf-run.ts`):
 * saved only when its read-back equals the upload's cells. A refusal after the build comes back
 * with every row that is not its cell; any refusal before it throws.
 */
export async function supplierPdf(actor: CmfActor, args: CmfPdfArgs, env: NodeJS.ProcessEnv = process.env): Promise<CmfSupplierPdfOutcome> {
  await requireCmf(actor)
  const { loaded, cmf } = await loadCmf(env)
  try {
    const result = await runCmfPdf(cmf, args, {
      ...deps.pdf,
      loadWorkbook: (id) => loadStoredWorkbook(deps.workbook, id),
      readKey: (entry) => deps.readKitFile(loaded, { path: entry.path, sha256: entry.sha256 }),
      clownBytes: ({ id }) => clownOfKey(env, loaded, cmf, id),
    })
    // Listed for the team, in both doors. The PDF is saved already; a row that fails to write is
    // said, never a reason to lose the PDF.
    const header = kitHeader(loaded)
    const listed = await deps.team
      .insertSupplierPdf({
        storagePath: result.path,
        url: result.url,
        fileName: result.file_name,
        importId: result.import_id,
        tab: result.tab,
        skuColumns: result.columns,
        skuNames: result.sku_names,
        outputIds: result.renders.map((r) => r.output_id),
        keyId: result.key.id,
        keySha256: result.key.sha256,
        keyConfirmedBy: result.key.confirmed_by,
        workbookFile: result.workbook.file,
        workbookSha256: result.workbook.sha256,
        workbookModified: result.workbook.modified,
        check: { clean: true, cells_compared: result.cells_compared, rows_compared: result.rows_compared },
        renders: result.renders,
        kitVersion: header.kit_version ?? null,
        kitTag: header.kit_tag ?? null,
        kitCommit: header.kit_commit ?? null,
        madeBy: actor.profileId,
        credentialId: actor.credentialId,
        door: actor.door,
      })
      .then((row) => ({ id: row.id }))
      .catch((err: unknown) => ({ error: (err as Error)?.message || 'unknown error' }))
    return { saved: true, loaded, result, listed }
  } catch (err) {
    if (err instanceof CmfPdfRefused) return { saved: false, loaded, refused: err }
    throw err
  }
}

// ------------------------------------------------------------------ checkPdf

export interface CmfCheckPdfInput {
  pdf_url?: string
  cmf_packet_id?: string
  tab: string
  columns?: string[]
  layout: 'vesper' | 'ours'
  clown?: string
  engine: 'vesper' | 'worker'
}

/** Every value on a CMF PDF against its sheet cell, in Vesper or on the creative worker; no gate. */
export async function runCheckPdf(actor: Pick<CmfActor, 'profileId'>, a: CmfCheckPdfInput, env: NodeJS.ProcessEnv = process.env): Promise<{ loaded: LoadedKit; result: SpecCheckResult }> {
  const { loaded, cmf } = await loadCmf(env)
  const { spec: specEntry } = resolveTab(cmf, a.tab)
  const specBytes = await deps.readKitFile(loaded, specEntry)
  const spec = JSON.parse(specBytes.toString('utf8')) as Spec
  let keyJson: { path: string; sha256: string; content: string } | null = null
  let key: ClownKey | null = null
  if (a.clown) {
    const k = resolveKey(cmf, specEntry, a.clown)
    const kb = await deps.readKitFile(loaded, { path: k.path, sha256: k.sha256 })
    key = JSON.parse(kb.toString('utf8')) as ClownKey
    keyJson = { path: k.path, sha256: k.sha256, content: kb.toString('utf8') }
  }
  let url = a.pdf_url ?? null
  if (a.cmf_packet_id) {
    const packet = await deps.packetPdf(a.cmf_packet_id, actor.profileId)
    if (!packet) throw new CmfError('that CMF packet is not one you can see, or it has no exported PDF yet')
    url = packet.url
  }
  const pdf = await deps.fetchPdf(url!)
  if (a.engine === 'worker') {
    const cfg = deps.worker(env)
    if (!cfg) throw new CmfError('the creative worker is not configured on this Vesper (CREATIVE_WORKER_URL, CREATIVE_WORKER_SECRET); the check runs in Vesper without engine: "worker"')
    const result = await checkPdfOnWorker(cfg, {
      pdfUrl: url!,
      pdfSha256: sha256Hex(pdf),
      spec: { path: specEntry.path, sha256: specEntry.sha256, content: specBytes.toString('utf8') },
      tab: spec.tab,
      columns: a.columns,
      layout: a.layout,
      keyJson,
    })
    return { loaded, result }
  }
  const result = await checkPdfInVesper({ pdf, spec, columns: a.columns, layout: a.layout, key })
  return { loaded, result }
}

/** The gate, then the check. */
export async function checkPdf(actor: CmfActor, a: CmfCheckPdfInput, env: NodeJS.ProcessEnv = process.env): Promise<{ loaded: LoadedKit; result: SpecCheckResult }> {
  await requireCmf(actor)
  return runCheckPdf(actor, a, env)
}
