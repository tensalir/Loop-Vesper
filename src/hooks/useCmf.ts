'use client'

/**
 * The CMF Studio's data: every call goes to `/api/cmf/v2/*`, the web door onto the CMF service
 * Claude's tools call too (`src/lib/creative/cmf/web-door.ts`). The shapes below are what those
 * routes answer; the words in a refusal are the service's, shown as they come.
 *
 * The History tab reads the packets made the old way through the read-only routes that stayed
 * (`/api/cmf/packets`, `/api/cmf/packets/{id}`). Nothing here writes to them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

// ------------------------------------------------------------------ shapes

export interface CmfKitHeader {
  kit_version: string
  kit_tag: string | null
  kit_ref?: string | null
  kit_commit: string | null
  kit_stale: boolean
  kit_stale_reason?: string | null
}

export interface CmfKeyState {
  id: string
  clown: string | null
  draft: boolean
  confirmed: boolean
}

export interface CmfListedTab {
  tab: string | null
  slug: string
  vesper_product: string | null
  skus: Array<{ column: string; header?: string | null; name?: string | null; in_scope: boolean; scope_reason?: string | null }>
  keys: CmfKeyState[]
  payloads: Array<{ id: string; column: string; sku_name: string | null; key: string; status: string; key_confirmed: boolean | null; reasons: string[] }>
}

export interface CmfTeamRender {
  output_id: string
  generation_id: string
  url: string
  made_at: string
  made_by: string | null
  door: 'mcp' | 'web' | null
  tab: string | null
  column: string | null
  sku_name: string | null
  key: string | null
  lane: string | null
  model: string | null
  kit_tag: string | null
  import_id: string | null
  grade: { grade_id: string; verdict: string; judge: string; judge_model: string | null; reads: number; at: string } | null
  answers: Array<{ answer: string; remark: string | null; by: string | null; decider: boolean; at: string }>
  decider_answer: { answer: string; remark: string | null; by: string; at: string } | null
  pdf_eligible: boolean
  pdf_why: string | null
}

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
  door: 'mcp' | 'web'
  made_at: string
}

export interface CmfListing extends CmfKitHeader {
  rubric_version: string | null
  /** The kit's CMF deciders by name: whose answer a supplier PDF counts. */
  deciders: string[]
  tabs: CmfListedTab[]
  uploads: Array<{ import_id: string; file: string; uploaded_at: string }>
  renders: CmfTeamRender[]
  supplier_pdfs: CmfListedPdf[]
  problems: string[]
}

export interface CmfUploadTab {
  tab: string
  slug: string | null
  vesper_product: string | null
  skus: Array<{ column: string; header: string | null; name: string | null; in_scope: boolean; scope_reason: string | null }>
  keys: CmfKeyState[]
}

export interface CmfUploadView {
  import_id: string
  file: string
  sha256: string | null
  modified: string | null
  modified_source: string | null
  imported_at: string
  tabs: CmfUploadTab[]
}

export interface CmfListedKey {
  id: string
  product: string | null
  variant: string | null
  draft: boolean
  confirmed: boolean
  tabs: string[]
  clown: { id: string; sha256: string; width: number | null; height: number | null } | null
  pinned: boolean
  clown_url: string | null
}

export interface CmfUploadTarget {
  import_id: string
  tab: string
  sku_column: string
  clown: string
}

export interface CmfPromptLine {
  n: number | string
  zone_hex: string
  component: string
  material: string
  finish: string
  colour_name: string
  colour_code: string
}

export type CmfPromptAnswer = CmfKitHeader &
  (
    | { refused: true; reasons: string[]; tab: string; column: string; key: string; import_id?: string }
    | {
        refused: false
        payload_id: string
        tab: string
        column: string
        sku_name: string | null
        key: { id: string; sha256: string; confirmed_by: string | null; confirmed_at: string | null } | { id: string }
        key_confirmed: boolean
        clown: { id: string; sha256: string; aspect?: string | null }
        prompt: string
        prompt_sha256: string
        template_sha256: string
        lines: CmfPromptLine[]
        omitted: Array<{ component: string; why: string }>
        warnings: string[]
        workbook?: { import_id: string; file: string; sha256: string; modified: string | null; sku_spec_sha256: string }
      }
  )

export interface CmfRenderPlanView {
  tab: string
  column: string
  sku_name: string | null
  key: string
  key_confirmed: boolean
  lane: 'final' | 'draft'
  model: string
  n: number
  prompt_sha256: string
  aspect: string
  image_size: string
}

export interface CmfRenderStarted extends CmfKitHeader {
  job_id: string
  status: 'processing'
  plan: CmfRenderPlanView
  estimated_cost_usd: number | null
}

export interface CmfRenderJob {
  job_id: string
  status: 'processing' | 'completed' | 'failed'
  result: {
    generationId: string
    outputs: Array<{ url: string; width: number; height: number; mimeType: string; outputId: string | null }>
    failures: string[]
    recorded: boolean
    record_error: string | null
    tab: string
    column: string
    key: string
  } | null
  error: string | null
  started_at: string
  completed_at: string | null
}

export interface CmfGradeAnswer extends CmfKitHeader {
  grade_id: string | null
  status: string
  verdict: string
  errors: number
  reads: unknown[]
  judge_model: string | null
  stored: boolean
  store_error?: string
  cmf: { tab: string; column: string; key: string; sku_name: string | null; import_id?: string }
  checks: Array<{ id: string; severity: string; caption: string; fails: number; reads: number }>
}

export interface CmfVerdictAnswer extends CmfKitHeader {
  verdict_id: string
  answer: 'yes' | 'no'
  grade_id: string | null
  decider: string | null
}

export interface CmfSupplierPdfAnswer extends CmfKitHeader {
  saved: true
  url: string
  file_name: string
  tab: string
  columns: string[]
  sku_names: Record<string, string | null>
  key: { id: string; sha256: string; confirmed_by: string }
  legend: string[]
  workbook: { file: string | null; sha256: string | null; modified: string | null; modified_source: string | null }
  renders: Array<{ column: string; output_id: string; decided_by: string; decided_at: string }>
  cells_compared: number
  rows_compared: number
  supplier_pdf_id: string | null
  listed_error?: string
}

export interface CmfCheckRow {
  tab: string
  column: string | null
  part: string
  component: string
  field: string
  sheet: string | null
  pdf: string | null
  state: string
  cause: string | null
  where: string | null
}

export interface CmfCheckAnswer extends CmfKitHeader {
  clean: boolean
  engine: string
  layout: string
  tab: string
  columns: string[]
  counts: Record<string, number>
  cells_compared: number
  notes: string[]
  pdf_sha256: string
  rows: CmfCheckRow[]
}

/** A refusal from the CMF service, in its own words, with what the step adds (reasons, rows, the allowance). */
export class CmfRequestError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message)
    this.name = 'CmfRequestError'
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new CmfRequestError(typeof data.error === 'string' ? data.error : `The request failed (${res.status}).`, res.status, data)
  return data as T
}

const post = <T,>(url: string, body: unknown) =>
  call<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ------------------------------------------------------------------ queries

export const CMF_QUERY = {
  listing: ['cmf', 'v2', 'listing'] as const,
  upload: (id: string | null) => ['cmf', 'v2', 'upload', id] as const,
  keys: ['cmf', 'v2', 'keys'] as const,
  prompt: (t: CmfUploadTarget | null) => ['cmf', 'v2', 'prompt', t?.import_id, t?.tab, t?.sku_column, t?.clown] as const,
  job: (id: string | null) => ['cmf', 'v2', 'job', id] as const,
  history: ['cmf', 'history'] as const,
  historyPacket: (id: string | null) => ['cmf', 'history', id] as const,
}

/** The kit's tabs and keys, the newest uploads, and the team's renders and supplier PDFs from both doors. */
export function useCmfListing() {
  return useQuery({
    queryKey: CMF_QUERY.listing,
    queryFn: () => call<CmfListing>('/api/cmf/v2/list'),
    staleTime: 10_000,
    // Renders made in Claude appear here too; a quiet refresh keeps the team's work current.
    refetchInterval: 30_000,
  })
}

export function useCmfUpload(importId: string | null) {
  return useQuery({
    queryKey: CMF_QUERY.upload(importId),
    queryFn: async () => (await call<{ upload: CmfUploadView }>(`/api/cmf/v2/uploads/${importId}`)).upload,
    enabled: Boolean(importId),
    staleTime: 5 * 60_000,
  })
}

export function useCmfKeys() {
  return useQuery({
    queryKey: CMF_QUERY.keys,
    queryFn: async () => call<CmfKitHeader & { keys: CmfListedKey[] }>('/api/cmf/v2/keys'),
    staleTime: 60_000,
  })
}

/** The exact prompt a render of this target sends, or why there is none. */
export function useCmfPrompt(target: CmfUploadTarget | null) {
  return useQuery({
    queryKey: CMF_QUERY.prompt(target),
    queryFn: () => post<CmfPromptAnswer>('/api/cmf/v2/prompt', target),
    enabled: Boolean(target),
    staleTime: 60_000,
    retry: false,
  })
}

/** A render the person started: polled while it draws; the listing is refreshed when it lands. */
export function useCmfRenderJob(jobId: string | null) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: CMF_QUERY.job(jobId),
    queryFn: async () => {
      const job = await call<CmfRenderJob>(`/api/cmf/v2/render/${jobId}`)
      if (job.status !== 'processing') await qc.invalidateQueries({ queryKey: CMF_QUERY.listing })
      return job
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => ((query.state.data as CmfRenderJob | undefined)?.status === 'processing' || !query.state.data ? 4000 : false),
  })
}

// ------------------------------------------------------------------ steps

function useStep<TArgs, TOut>(fn: (a: TArgs) => Promise<TOut>, refresh = true) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      if (refresh) await qc.invalidateQueries({ queryKey: CMF_QUERY.listing })
    },
  })
}

export function useUploadWorkbook() {
  return useStep(async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return (await call<{ upload: CmfUploadView }>('/api/cmf/v2/uploads', { method: 'POST', body: form })).upload
  })
}

export function useStartRender() {
  return useStep((a: CmfUploadTarget & { lane: 'final' | 'draft'; n?: number }) => post<CmfRenderStarted>('/api/cmf/v2/render', a), false)
}

export function useGradeRender() {
  return useStep((a: { output_id: string; import_id?: string; tab?: string; column?: string; clown?: string }) => post<CmfGradeAnswer>('/api/cmf/v2/grade', a))
}

export function useRecordAnswer() {
  return useStep((a: { output_id: string; grade_id?: string; answer: 'yes' | 'no'; remark: string }) => post<CmfVerdictAnswer>('/api/cmf/v2/verdict', a))
}

export function useMakeSupplierPdf() {
  return useStep((a: { import_id: string; tab: string; sku_columns: string[]; output_ids: string[] }) => post<CmfSupplierPdfAnswer>('/api/cmf/v2/pdf', a))
}

export function useCheckPdf() {
  return useStep((a: { pdf_url?: string; cmf_packet_id?: string; tab: string; columns?: string[]; layout?: 'vesper' | 'ours' }) => post<CmfCheckAnswer>('/api/cmf/v2/check-pdf', a), false)
}

// ------------------------------------------------------------------ history, made the old way (read only)

export interface CmfHistoryAttempt {
  id: string
  attemptNumber: number
  status: string
  approvalStatus: string
  imageUrl: string | null
  modelId: string | null
  basePrompt: string | null
  enhancedPrompt: string | null
  refinementPrompt: string | null
  createdAt: string
}

export interface CmfHistoryRender {
  id: string
  label: string
  productSlug: string
  colorwayName: string | null
  productCode: string | null
  status: string
  renderUrl: string | null
  renderAttempts?: CmfHistoryAttempt[]
}

export interface CmfHistoryPacket {
  id: string
  name: string
  cmfCode: string | null
  status: string
  pdfUrl: string | null
  createdAt: string
  updatedAt: string
  renders: CmfHistoryRender[]
}

export function useCmfHistory() {
  return useQuery({
    queryKey: CMF_QUERY.history,
    queryFn: async () => (await call<{ packets: CmfHistoryPacket[] }>('/api/cmf/packets')).packets ?? [],
    staleTime: 5 * 60_000,
  })
}

export function useCmfHistoryPacket(packetId: string | null) {
  return useQuery({
    queryKey: CMF_QUERY.historyPacket(packetId),
    queryFn: async () => (await call<{ packet: CmfHistoryPacket }>(`/api/cmf/packets/${packetId}`)).packet,
    enabled: Boolean(packetId),
    staleTime: 5 * 60_000,
  })
}
