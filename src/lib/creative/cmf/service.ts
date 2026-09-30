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
 *   listCmf          the kit's tabs, SKUs, keys and ready prompts, and the newest uploads
 *   cmfPrompt        Damien's template filled by code (an upload's cells, or the kit's payload)
 *   planRender       every refusal before anything is paid for; then runRender draws and records
 *   planGrade        the kit's grader for one render; runGrade reads it and stores the grade
 *   recordCmfVerdict a person's yes or no on a render, and whether the kit names them its decider
 *   supplierPdf      the supplier PDF from one upload and approved renders, checked, then saved
 *   checkPdf         every value on a CMF PDF against its sheet cell
 *
 * Every function takes the actor (who asks, through which door) and applies one gate: CMF access
 * on the profile (`cmf_access`, or an admin), read fresh on every call. What a door does beyond
 * that (parsing its arguments, the words it answers with, running a long call as a job) stays in
 * the door. Pure where it can be; everything it reaches is in `CmfServiceDeps`, so tests swap it.
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
import { CMF_STORAGE_BUCKET } from '@/lib/cmf/storage'
import { recordMcpGeneration, type RecordMcpGenerationInput, type RecordMcpGenerationResult } from '@/lib/headless/record-generation'
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
import { PromptRefusal } from './prompt-fill'
import { buildWorkbookPayload } from './workbook-payload'
import { loadStoredWorkbook, type WorkbookImportRow, type WorkbookSourceDeps } from './workbook-source'
import { CmfPdfRefused, deciderEmails, runCmfPdf, type CmfPdfArgs, type CmfPdfDeps, type CmfPdfResult, type RenderOutputRow, type VerdictRow } from './supplier-pdf-run'
import type { SupplierPdfImage } from './supplier-pdf'
import { checkCmfTarget, gradeCmfCandidate } from './grading'

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
  /** A render's generation and outputs, written where the web app shows them. */
  recordRender(input: RecordMcpGenerationInput): Promise<RecordMcpGenerationResult>
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
  recordRender: (input) => recordMcpGeneration(input),
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

export interface CmfListing {
  loaded: LoadedKit
  cmf: CmfKit
  tabs: CmfListedTab[]
  uploads: Array<{ import_id: string; file: string; uploaded_at: string }>
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
  return { loaded, cmf, tabs: out, uploads }
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
    const result = await deps.recordRender({
      ownerId: actor.profileId,
      generationId,
      stream: 'cmf',
      modelId: vesperModelId(plan.model),
      prompt: plan.prompt,
      costUsd,
      outputs: stored.map((s) => ({ url: s.url, width: s.width || null, height: s.height || null })),
      parameters: {
        toolName: 'cmf_render',
        source: 'mcp',
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
    })
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

/** A CMF render to grade: its sheet row and clown key, and the picture. */
export interface CmfGradeTarget {
  /** The product kit, when the door has already read it (grade_image resolves the product first). */
  loaded?: LoadedKit
  tab: string
  column: string
  clown: string
  output_id?: string
  frontify_asset_id?: string
  image_url?: string
  runs?: number
}

export interface CmfGradeReady {
  loaded: LoadedKit
  cmf: CmfKit
  parts: CmfGradingParts
  target: { spec: string; column: string; key: string; tab: string; sku_name: string | null }
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

/** The gate, the tab, column and key against the kit, before any read is paid for. */
export async function planGrade(actor: CmfActor, t: CmfGradeTarget, env: NodeJS.ProcessEnv = process.env): Promise<CmfGradeReady> {
  await requireCmf(actor)
  const loaded = t.loaded ?? (await deps.loadKit(env))
  const cmf = cmfKit(loaded.kit)
  const { slug: specSlug } = resolveTab(cmf, t.tab)
  const column = t.column.toUpperCase()
  const parts = await cmfGradingParts(loaded, cmf)
  const { tab, skuName } = checkCmfTarget(cmf, parts, specSlug, column, t.clown)
  const target = { spec: specSlug, column, key: t.clown, tab, sku_name: skuName }
  return { loaded, cmf, parts, target, picture: { output_id: t.output_id, frontify_asset_id: t.frontify_asset_id, image_url: t.image_url }, runs: t.runs }
}

/** Three reads of one render against its row and its clown, stored in `creative_grades`. */
export async function runGrade(actor: CmfActor, ready: CmfGradeReady, env: NodeJS.ProcessEnv = process.env): Promise<CmfGradeExecution> {
  const { loaded, cmf, parts, target } = ready
  const product = cmf.product
  const candidate = await loadCandidate(ready.picture, actor.profileId, deps.candidate(env))
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
    const candidate = await loadCandidate({ image_url: v.image_url }, actor.profileId, deps.candidate(env))
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

export type CmfSupplierPdfOutcome = { saved: true; loaded: LoadedKit; result: CmfPdfResult } | { saved: false; loaded: LoadedKit; refused: CmfPdfRefused }

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
    return { saved: true, loaded, result }
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
