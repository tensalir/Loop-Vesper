/**
 * The gate a supplier CMF PDF passes before it is saved: its own bytes, read back as text
 * (`pdf-lines.ts`, pdf.js read the way pypdf reads), compared with the parse of the same upload.
 *
 *   - every SKU page, by `spec-diff.ts` in the `ours` layout: the header's nine cells, every
 *     component field, the footer (workbook file, modified time, sha256), and the legend's order
 *     against the key that built the prompt; the rows and states of `spec_diff.py`
 *   - the page order: one page per SKU in the columns asked, then the one part-breakdown page
 *   - the footer on every page, the part-breakdown page's too
 *   - the part-breakdown page's header and shared cells, against the cells every SKU shares
 *     (spec_diff.py reads no value on that page; Vesper checks them anyway, since they are
 *     printed for a supplier)
 *
 * Any row that is not a match refuses the PDF, and nothing is saved.
 */

import { pdfPages } from './pdf-lines'
import { collapse, OURS_SHARED_TITLE, parseOursPage, printedFromPages, runSpecCheck, type ClownKey, type Row, type Spec, type State } from './spec-diff'
import { HEADER_CELLS, sharedBannerText, sharedBreakdownFields } from './supplier-pdf'
import type { WorkbookInfo } from './workbook'

export interface SupplierCheckRow extends Row {
  /** 1-based page number, where the row is about one page. */
  page?: number | null
}

export interface SupplierCheck {
  clean: boolean
  rows: SupplierCheckRow[]
  notes: string[]
  pages: string[][]
  cells_compared: number
  counts: Record<State, number>
}

function row(spec: Spec, part: string, component: string, field: string, sheet: string | null, pdf: string | null, state: State, extra: Partial<SupplierCheckRow> = {}): SupplierCheckRow {
  return { tab: spec.tab, column: null, sku_name: null, part, component, field, pdf_label: null, sheet, pdf, state, cause: null, where: null, ...extra }
}

function judge(sheet: string, pdf: string | null): State {
  const s = collapse(sheet)
  const p = collapse(pdf ?? '')
  if (s === p) return 'match'
  if (!s) return 'extra_in_pdf'
  if (!p) return 'missing_in_pdf'
  return 'mismatch'
}

/** The part-breakdown page's cells: the header every SKU shares, and the per-component shared cells. */
function checkBreakdown(spec: Spec, columns: string[], lines: string[], pageNo: number): SupplierCheckRow[] {
  const rows: SupplierCheckRow[] = []
  const parsed = parseOursPage(lines, spec)
  const bannerNames = ['CMF number', 'Collection', 'Product Name', 'Product Code', 'EAN code', 'Edit Date', 'Drawn by', 'Checked by 1', 'Checked by 2']
  HEADER_CELLS.forEach((cell, k) => {
    const want = sharedBannerText(spec, cell.field, columns)
    const got = parsed.header[bannerNames[k]] ?? null
    rows.push(row(spec, 'breakdown', 'BANNER', cell.field, collapse(want), got === null ? null : collapse(got), got === null ? 'missing_in_pdf' : judge(want, got), { page: pageNo }))
  })
  const body = lines.filter((ln) => !/^--\s*\d+\s+of\s+\d+\s*--$/.test(ln) && !ln.includes(' · sha256 '))
  const start = body.indexOf(OURS_SHARED_TITLE)
  if (start < 0) {
    rows.push(row(spec, 'breakdown', 'BREAKDOWN', `(${OURS_SHARED_TITLE})`, OURS_SHARED_TITLE, null, 'missing_in_pdf', { page: pageNo }))
    return rows
  }
  const rest = body.slice(start + 1)
  const headers = spec.components.map((c) => c.header)
  const blocks = new Map<string, string[]>()
  let current: string | null = null
  for (const ln of rest) {
    if (headers.includes(ln) && !blocks.has(ln)) {
      current = ln
      blocks.set(ln, [])
    } else if (current) blocks.get(current)!.push(ln)
    else rows.push(row(spec, 'breakdown', 'BREAKDOWN', '(text before the first component)', '', ln, 'extra_in_pdf', { page: pageNo }))
  }
  for (const comp of spec.components) {
    const seg = blocks.get(comp.header)
    if (!seg) {
      rows.push(row(spec, 'breakdown', comp.header, '(heading)', comp.header, null, 'missing_in_pdf', { page: pageNo, where: `${spec.tab}!A${comp.row}` }))
      continue
    }
    const want = sharedBreakdownFields(comp, columns)
    const names = comp.fields.map((f) => f.name)
    const printed: Record<string, string> = {}
    let j = 0
    while (j < seg.length) {
      if (names.includes(seg[j])) {
        const name = seg[j]
        const vals: string[] = []
        j++
        while (j < seg.length && !names.includes(seg[j])) vals.push(seg[j++])
        printed[name] = collapse(vals.join(' '))
      } else {
        rows.push(row(spec, 'breakdown', comp.header, '(unlabelled text)', '', seg[j], 'extra_in_pdf', { page: pageNo }))
        j++
      }
    }
    for (const w of want) {
      const got = Object.prototype.hasOwnProperty.call(printed, w.field.name) ? printed[w.field.name] : null
      rows.push(row(spec, 'breakdown', comp.header, w.field.name, collapse(w.text), got, got === null ? 'missing_in_pdf' : judge(w.text, got), { page: pageNo, where: `${spec.tab}!${columns.join('/')}${w.field.row}` }))
    }
    for (const [name, val] of Object.entries(printed)) {
      if (!want.some((w) => w.field.name === name)) rows.push(row(spec, 'breakdown', comp.header, name, '', val, 'extra_in_pdf', { page: pageNo }))
    }
  }
  return rows
}

/**
 * The whole gate on a built PDF. `columns` are the SKU columns in page order; `key` the clown
 * key the prompt and the legend were built from; `workbook` the upload the spec was parsed from.
 */
export async function checkSupplierPdf(args: { bytes: Uint8Array; spec: Spec; columns: string[]; key: ClownKey; workbook: WorkbookInfo }): Promise<SupplierCheck> {
  const { spec, columns } = args
  const pages = await pdfPages(args.bytes)
  const rows: SupplierCheckRow[] = []
  const notes: string[] = []

  // The page order: one page per SKU asked, in order, then one part-breakdown page.
  const kinds = pages.map((p) => parseOursPage(p, spec).kind)
  const wantKinds = [...columns.map(() => 'sku'), 'breakdown']
  if (kinds.length !== wantKinds.length || kinds.some((k, i) => k !== wantKinds[i])) {
    rows.push(row(spec, 'page', 'PAGES', 'order', wantKinds.join(', '), kinds.join(', '), 'mismatch'))
  }

  // Every SKU page against its sheet cells, the legend against the key: spec_diff.py's rows.
  const { byColumn, legend, notes: pageNotes } = printedFromPages(pages, spec, 'ours')
  notes.push(...pageNotes)
  const check = runSpecCheck(spec, byColumn, legend, columns, 'ours', args.key)
  rows.push(...check.rows.map((r) => ({ ...r, page: r.column && byColumn[r.column] ? byColumn[r.column].page : null })))
  columns.forEach((col, i) => {
    const at = byColumn[col]?.page
    if (at !== undefined && at !== i + 1) rows.push(row(spec, 'page', 'PAGES', `column ${col}`, `page ${i + 1}`, `page ${at}`, 'mismatch', { column: col }))
  })

  // The footer on every page, the part-breakdown page's included.
  pages.forEach((p, i) => {
    const ft = parseOursPage(p, spec).footer ?? {}
    const wb = args.workbook
    const ok = collapse(ft.workbook) === collapse(wb.file) && collapse(ft.modified) === collapse(wb.modified) && !!ft.sha256 && ft.sha256.length >= 12 && String(wb.sha256).startsWith(ft.sha256)
    if (!ok) {
      rows.push(
        row(spec, 'footer', 'FOOTER', `page ${i + 1}`, `${wb.file} · modified ${wb.modified} · sha256 ${String(wb.sha256).slice(0, 12)}`, ft.workbook ? `${ft.workbook} · modified ${ft.modified} · sha256 ${ft.sha256}` : null, ft.workbook ? 'mismatch' : 'missing_in_pdf', {
          page: i + 1,
          cause: ft.workbook ? null : 'no_traceability',
        })
      )
    }
  })

  // The part-breakdown page's own cells.
  if (pages.length && kinds[kinds.length - 1] === 'breakdown') rows.push(...checkBreakdown(spec, columns, pages[pages.length - 1], pages.length))
  for (const n of notes) rows.push(row(spec, 'page', 'PAGES', 'title', null, n, 'extra_in_pdf'))

  const counts = { match: 0, mismatch: 0, missing_in_pdf: 0, empty_in_sheet: 0, extra_in_pdf: 0 } as Record<State, number>
  for (const r of rows) counts[r.state] += 1
  return { clean: rows.every((r) => r.state === 'match'), rows, notes, pages, cells_compared: check.cells_compared, counts }
}

/** The refusal, row by row: SKU, component, field, cell, workbook value, PDF value. */
export function supplierCheckText(spec: Spec, check: SupplierCheck, max = 40): string {
  const bad = check.rows.filter((r) => r.state !== 'match')
  const lines = [`The PDF was not saved: ${bad.length} value(s) on it are not their workbook cell (${spec.tab}).`]
  for (const r of bad.slice(0, max)) {
    const sku = r.column ? `SKU ${r.column}${r.sku_name ? ` (${r.sku_name})` : ''}` : r.page ? `page ${r.page}` : 'the PDF'
    const why = r.state === 'empty_in_sheet' ? 'the cell is empty or a placeholder in the workbook' : r.state.replace(/_/g, ' ')
    lines.push(
      `- ${sku} · ${r.component} · ${r.field}${r.where ? ` · cell ${r.where}` : ''}: workbook ${JSON.stringify(r.sheet ?? '')}, PDF ${JSON.stringify(r.pdf ?? '')} (${why}${r.cause ? `, ${r.cause}` : ''})`
    )
  }
  if (bad.length > max) lines.push(`(${bad.length - max} more in structuredContent.rows)`)
  lines.push('Fix the cell in the workbook (or the export, if the cell is right), upload it again, and ask for the PDF again.')
  return lines.join('\n')
}
