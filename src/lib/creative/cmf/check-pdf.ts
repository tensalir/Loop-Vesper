/**
 * The spec check of a CMF PDF from Claude: every value printed on a supplier PDF against its sheet
 * cell, per SKU, component and field, with the states and cause slugs of the plugin repository's
 * `scripts/spec_diff.py`. One mismatch or one empty required cell and the PDF does not go out.
 *
 * Two engines, the same answer:
 *   vesper  the PDF's text read with pdf.js (`pdf-lines.ts`, proved line for line against pypdf on
 *           Vesper's own export) and compared by the port (`spec-diff.ts`, held to the script's
 *           rows on the real case and the repository's synthetic cases). The default.
 *   worker  the repository's own script, run by the creative worker (`worker-client.ts`), for a
 *           layout the port has not been proved on, or when asked.
 */

import crypto from 'crypto'
import { pdfPages } from './pdf-lines'
import { collapse, printedFromPages, runSpecCheck, type ClownKey, type Row, type Spec, type State, STATES } from './spec-diff'
import { callWorker, type WorkerConfig } from './worker-client'
import { CmfError } from './kit-cmf'

export type SpecEngine = 'vesper' | 'worker'
export type SpecLayout = 'vesper' | 'ours'

export interface SpecCheckResult {
  engine: SpecEngine
  tab: string
  columns: string[]
  layout: SpecLayout
  rows: Row[]
  counts: Record<State, number>
  summary: Record<string, Record<State, number>>
  cells_compared: number
  assertions: { footer_names_sheet_and_time: boolean; legend_from_clown_key: boolean }
  notes: string[]
  clean: boolean
  pdf_sha256: string
}

/** workbook.resolve_sku: a column letter always; a header or Product Name only when one column has it. */
export function resolveSku(spec: Spec, query: string): string {
  const q = collapse(query).toLowerCase()
  const byLetter = spec.skus.find((s) => collapse(s.column).toLowerCase() === q)
  if (byLetter) return byLetter.column
  const hits = spec.skus.filter((s) => q === collapse(s.header).toLowerCase() || q === collapse(s.name ?? '').toLowerCase())
  if (hits.length === 1) return hits[0].column
  if (!hits.length) {
    throw new CmfError(`no SKU '${query}' in ${spec.tab}; columns: ${spec.skus.map((s) => `${s.column} (${s.name ?? s.header ?? ''})`).join(', ')}`)
  }
  throw new CmfError(`'${query}' names ${hits.length} columns in ${spec.tab}: ${hits.map((s) => s.column).join(', ')}. Name the column letter instead.`)
}

function summaryOf(rows: Row[]): Record<string, Record<State, number>> {
  const out: Record<string, Record<State, number>> = {}
  for (const r of rows) {
    const col = r.column ?? '(legend)'
    out[col] ??= Object.fromEntries(STATES.map((s) => [s, 0])) as Record<State, number>
    out[col][r.state] += 1
  }
  return out
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** The check in Vesper: pdf.js lines, the ported comparison. */
export async function checkPdfInVesper(args: {
  pdf: Buffer
  spec: Spec
  columns?: string[]
  layout: SpecLayout
  key?: ClownKey | null
}): Promise<SpecCheckResult> {
  const pages = await pdfPages(args.pdf)
  const { byColumn, legend, notes } = printedFromPages(pages, args.spec, args.layout)
  const asked = (args.columns ?? []).map((q) => resolveSku(args.spec, q))
  const columns = asked.length ? asked : args.spec.skus.filter((s) => s.column in byColumn).map((s) => s.column)
  if (!columns.length) {
    throw new CmfError(
      `no SKU page of ${args.spec.tab} was found in the PDF (${pages.length} page(s) read, layout ${args.layout}). If the PDF is another layout, run the check with engine: "worker".`
    )
  }
  const out = runSpecCheck(args.spec, byColumn, legend, columns, args.layout, args.key ?? null)
  return {
    engine: 'vesper',
    tab: args.spec.tab,
    columns,
    layout: args.layout,
    rows: out.rows,
    counts: out.counts,
    summary: summaryOf(out.rows),
    cells_compared: out.cells_compared,
    assertions: out.assertions,
    notes,
    clean: out.clean,
    pdf_sha256: sha256Hex(args.pdf),
  }
}

/** The check by the repository's own script, through the creative worker. */
export async function checkPdfOnWorker(
  cfg: WorkerConfig,
  args: { pdfUrl: string; pdfSha256: string; spec: { path: string; sha256: string; content: string }; tab: string; columns?: string[]; layout: SpecLayout; keyJson?: { path: string; sha256: string; content: string } | null }
): Promise<SpecCheckResult> {
  const answer = await callWorker<{
    tab: string
    columns: string[]
    layout: SpecLayout
    rows: Row[]
    counts: Record<State, number>
    summary?: Record<string, Record<State, number>>
    cells_compared: number
    assertions: SpecCheckResult['assertions']
    notes?: string[]
    clean: boolean
  }>(cfg, '/v1/spec-diff', {
    pdf: { url: args.pdfUrl, sha256: args.pdfSha256 },
    spec: args.spec,
    tab: args.tab,
    ...(args.columns?.length ? { columns: args.columns } : {}),
    layout: args.layout,
    ...(args.keyJson ? { key: args.keyJson } : {}),
  })
  return {
    engine: 'worker',
    tab: answer.tab,
    columns: answer.columns,
    layout: answer.layout,
    rows: answer.rows,
    counts: answer.counts,
    summary: answer.summary ?? summaryOf(answer.rows),
    cells_compared: answer.cells_compared,
    assertions: answer.assertions,
    notes: answer.notes ?? [],
    clean: answer.clean,
    pdf_sha256: args.pdfSha256,
  }
}

/** The answer in plain words: clean or not, per SKU, then the rows that are not a match. */
export function specCheckText(r: SpecCheckResult, maxRows = 60): string {
  const bad = r.rows.filter((x) => x.state !== 'match')
  const lines = [
    r.clean
      ? `The PDF matches the sheet: ${r.tab}, column(s) ${r.columns.join(', ')}, ${r.cells_compared} cell(s) compared, plus the footer and the legend. It may go out.`
      : `The PDF does not match the sheet and must not go out: ${bad.length} value(s) differ (${r.tab}, column(s) ${r.columns.join(', ')}; ${r.cells_compared} cell(s) compared).`,
    `Engine: ${r.engine === 'vesper' ? "Vesper's port of spec_diff.py" : "the repository's spec_diff.py, on the creative worker"}; layout ${r.layout}; PDF sha256 ${r.pdf_sha256.slice(0, 12)}.`,
  ]
  for (const [col, c] of Object.entries(r.summary)) {
    lines.push(`- ${col}: ${STATES.filter((s) => c[s]).map((s) => `${c[s]} ${s}`).join(', ') || 'nothing compared'}`)
  }
  if (!r.assertions.footer_names_sheet_and_time) lines.push('The footer does not name the workbook, its time and its sha256 (no traceability).')
  for (const n of r.notes) lines.push(`Note: ${n}`)
  if (bad.length) {
    lines.push('', '| Col | Component · field | State | Cause | Sheet | PDF |', '|---|---|---|---|---|---|')
    for (const x of bad.slice(0, maxRows)) {
      const cut = (v: string | null) => (v === null ? '' : v.length > 46 ? `${v.slice(0, 43)}...` : v).replace(/\|/g, '/')
      lines.push(`| ${x.column ?? ''} | ${x.component} · ${x.field} | ${x.state} | ${x.cause ?? ''} | ${cut(x.sheet)} | ${cut(x.pdf)} |`)
    }
    if (bad.length > maxRows) lines.push(`(${bad.length - maxRows} more in structuredContent.rows)`)
  }
  lines.push('A value is copied from its sheet cell or it is not right; the fix is in the export, never in the sheet. Damien decides.')
  return lines.join('\n')
}
