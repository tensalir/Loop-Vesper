/**
 * The workbook a CMF render or PDF is made from: an upload Vesper keeps, named by its import id.
 *
 * The web CMF Studio keeps every workbook Damien uploads at `cmf/{owner}/imports/{id}.xlsx`. The
 * CMF tools read that file byte for byte and parse it with `workbook.ts` (a port of workbook.py,
 * sharing no code with the web importer), so the prompt of a render and the values of a PDF come
 * from one parse of one file, and each records which (the import id and the file's sha256).
 * Claude names the upload, the tab and the SKU column; it never passes a cell's value.
 *
 * A later change reads the live Google Sheet through the same reader instead of an upload.
 */

import { CmfError, type CmfKit } from './kit-cmf'
import { resolveTab } from './kit-cmf'
import type { Spec } from './spec-diff'
import { isoSeconds, parseWorkbookBytes, tabSlug, workbookInfoForUpload, type WorkbookInfo } from './workbook'

export interface WorkbookImportRow {
  id: string
  ownerId: string
  fileName: string
  storagePath: string | null
  createdAt: Date
}

/** What loading an upload reaches: the import row, the stored bytes, the stored file's own Last-Modified. */
export interface WorkbookSourceDeps {
  importRow(importId: string): Promise<WorkbookImportRow | null>
  bytes(storagePath: string): Promise<Buffer>
  storedLastModified(storagePath: string): Promise<Date | null>
}

export interface StoredWorkbook {
  importId: string
  ownerId: string
  fileName: string
  storagePath: string
  /** When the import row was made in Vesper (shown to people; never printed as the workbook's time). */
  importedAt: string
  info: WorkbookInfo
  specs: Record<string, Spec>
}

/** The upload, read and parsed, or a refusal that says what is missing. */
export async function loadStoredWorkbook(deps: WorkbookSourceDeps, importId: string): Promise<StoredWorkbook> {
  const row = await deps.importRow(importId)
  if (!row) throw new CmfError(`no workbook upload '${importId}' in Vesper; cmf_list names the newest uploads`)
  if (!row.storagePath) {
    throw new CmfError(`the upload '${importId}' (${row.fileName}) has no stored file: it was imported before Vesper kept the workbook. Upload the workbook again in the CMF Studio.`)
  }
  let bytes: Buffer
  try {
    bytes = await deps.bytes(row.storagePath)
  } catch (err) {
    throw new CmfError(`the stored workbook of upload '${importId}' could not be read (${(err as Error)?.message || 'unknown error'}). Nothing was made.`)
  }
  const storedLastModified = await deps.storedLastModified(row.storagePath).catch(() => null)
  const info = workbookInfoForUpload({ bytes, fileName: row.fileName, storedLastModified })
  let specs: Record<string, Spec>
  try {
    specs = parseWorkbookBytes(bytes, info)
  } catch (err) {
    throw new CmfError(`the stored workbook of upload '${importId}' is not a workbook Vesper can read (${(err as Error)?.message || 'unknown error'})`)
  }
  return { importId: row.id, ownerId: row.ownerId, fileName: row.fileName, storagePath: row.storagePath, importedAt: isoSeconds(row.createdAt), info, specs }
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A tab of the upload, by its sheet name or slug, together with the kit's entry for that tab
 * (which product's clown keys it takes). A tab the upload lacks, or the kit does not know, is
 * refused by name.
 */
export function workbookTab(wb: StoredWorkbook, cmf: CmfKit, query: string): { spec: Spec; kitSlug: string; vesperProduct: string | null } {
  const q = fold(query)
  const title = Object.keys(wb.specs).find((t) => fold(t) === q || tabSlug(t) === q)
  if (!title) throw new CmfError(`the upload '${wb.importId}' (${wb.fileName}) has no tab '${query}'; its tabs: ${Object.keys(wb.specs).join(', ')}`)
  const { slug, spec } = resolveTab(cmf, title)
  return { spec: wb.specs[title], kitSlug: slug, vesperProduct: spec.vesper_product }
}
