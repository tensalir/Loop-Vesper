/**
 * cmf_pdf, the whole run: from identifiers (an upload, a tab, SKU columns, approved renders) to a
 * supplier PDF saved beside the upload, or a refusal that says why and saves nothing.
 *
 *   1. the upload is read and parsed (`workbook-source.ts`); the tab and columns are its own
 *   2. each render is a CMF engine render (`cmf_render`, from Claude or the CMF Studio, any of
 *      the team's, whoever made it) made from a workbook upload, with a yes from the CMF decider
 *      (the latest answer of a person the kit names as CMF decider, by email); an attempt the web
 *      CMF Studio made the old way is refused, its clown is not recorded
 *   3. the renders share one clown key; the kit's key is still that key (same sha256) and Damien
 *      has confirmed it; the legend is built from it
 *   4. each render's recorded cells equal the upload's cells now for its SKU, else the fields that
 *      changed are named so Damien renders again
 *   5. the PDF is built (`supplier-pdf.ts`), read back and checked (`supplier-pdf-check.ts`);
 *      any row that is not a match refuses, naming SKU, component, field, cell and both values
 *   6. on a clean check the PDF is stored at `cmf/{owner}/imports/{import}/pdf/{time}/{file}`
 *
 * Claude passes identifiers only; no value reaches the PDF except from the workbook's cells.
 */

import { CmfError, type CmfKey, type CmfKit } from './kit-cmf'
import { isDraftKey, skuSpecChanges, skuSpecView, type ClownKeyFile, type SkuSpecView } from './prompt-fill'
import { buildSupplierPdf, type SupplierPdfImage } from './supplier-pdf'
import { checkSupplierPdf, supplierCheckText, type SupplierCheck } from './supplier-pdf-check'
import { workbookTab, type StoredWorkbook } from './workbook-source'
import { collapse, type ClownKey, type Spec } from './spec-diff'

export interface RenderOutputRow {
  id: string
  fileUrl: string
  generationId: string
  ownerId: string
  parameters: Record<string, unknown> | null
}

export interface VerdictRow {
  id: string
  profileId: string
  credentialId: string | null
  answer: string
  remark: string | null
  createdAt: Date
}

export interface CmfPdfDeps {
  loadWorkbook(importId: string): Promise<StoredWorkbook>
  readKey(entry: CmfKey): Promise<Buffer>
  renderOutput(outputId: string): Promise<RenderOutputRow | null>
  /** True when the id is a web CMF Studio attempt (`cmf_render_attempts`), not a Claude render. */
  webAttempt(id: string): Promise<boolean>
  verdicts(outputId: string, product: string): Promise<VerdictRow[]>
  /** The email a verdict was given under: its sign-in's, else the account's. */
  verdictEmail(v: VerdictRow): Promise<string | null>
  imageBytes(url: string): Promise<SupplierPdfImage>
  clownBytes(key: { id: string; entry: CmfKey }): Promise<SupplierPdfImage | null>
  storePdf(path: string, bytes: Uint8Array): Promise<string>
  now(): Date
}

export interface CmfPdfArgs {
  import_id: string
  tab: string
  sku_columns: string[]
  output_ids: string[]
}

export interface CmfPdfRender {
  column: string
  output_id: string
  decided_by: string
  decided_at: string
  prompt_sha256: string | null
  clown_sha256: string | null
  rendered_from_import: string
}

export interface CmfPdfResult {
  url: string
  path: string
  file_name: string
  import_id: string
  tab: string
  columns: string[]
  sku_names: Record<string, string | null>
  key: { id: string; sha256: string; confirmed_by: string }
  legend: string[]
  pages: Array<{ kind: 'sku' | 'breakdown'; column: string | null }>
  workbook: { file: string | null; sha256: string | null; modified: string | null; modified_source: string | null; imported_at: string }
  renders: CmfPdfRender[]
  cells_compared: number
  rows_compared: number
}

/** A refusal after the PDF was built and read back: every row that is not its cell. Nothing was saved. */
export class CmfPdfRefused extends CmfError {
  constructor(message: string, readonly check: SupplierCheck) {
    super(message)
    this.name = 'CmfPdfRefused'
  }
}

interface RecordedRender {
  output: RenderOutputRow
  tab: string
  column: string
  keyId: string
  keySha256: string | null
  clownSha256: string | null
  promptSha256: string | null
  importId: string
  skuSpec: SkuSpecView
}

function recorded(output: RenderOutputRow): RecordedRender {
  const p = (output.parameters ?? {}) as Record<string, any>
  if (p.toolName !== 'cmf_render' || (p.source !== 'mcp' && p.source !== 'web')) {
    throw new CmfError(`output ${output.id} is not a CMF render made by the CMF engine (cmf_render, from Claude or the CMF Studio); a supplier PDF takes only those, with Damien's yes`)
  }
  const c = (p.creative ?? {}) as Record<string, any>
  const wb = c.workbook as Record<string, any> | undefined
  if (c.product !== 'cmf' || !wb || !wb.sku_spec) {
    throw new CmfError(
      `output ${output.id} was rendered from the kit's saved copy of the sheet, not from a workbook upload, so its cells cannot be held to this workbook. Render it again with cmf_render and import_id.`
    )
  }
  return {
    output,
    tab: String(c.tab),
    column: String(c.column).toUpperCase(),
    keyId: String(c.key),
    keySha256: (c.key_sha256 as string | undefined) ?? null,
    clownSha256: (c.payload?.clown?.sha256 as string | undefined) ?? null,
    promptSha256: (c.payload?.prompt_sha256 as string | undefined) ?? null,
    importId: String(wb.import_id),
    skuSpec: wb.sku_spec as SkuSpecView,
  }
}

/** The kit's CMF deciders who carry an email, lower case. */
export function deciderEmails(cmf: CmfKit): Array<{ name: string; email: string }> {
  return ((cmf.product.deciders ?? []) as Array<Record<string, unknown>>)
    .filter((d) => typeof d.email === 'string' && (d.email as string).includes('@'))
    .map((d) => ({ name: String(d.name ?? d.role ?? 'the CMF decider'), email: String(d.email).trim().toLowerCase() }))
}

/** Two SKUs of one Product Name must appear in column order, the earlier first, or the check reads a page as the wrong SKU. */
function refuseAmbiguousNames(spec: Spec, columns: string[]): void {
  for (const col of columns) {
    const name = collapse(spec.skus.find((s) => s.column === col)?.name ?? '')
    const same = spec.skus.filter((s) => collapse(s.name ?? '') === name).map((s) => s.column)
    const before = same.slice(0, same.indexOf(col))
    const missing = before.filter((c) => !columns.includes(c))
    if (missing.length) {
      throw new CmfError(
        `${spec.tab} columns ${same.join(' and ')} share the Product Name '${name}', so a page names no single SKU: a PDF with ${col} must also carry ${missing.join(', ')}, or the sheet gives each its own Product Name`
      )
    }
  }
}

/** The whole run; see the module comment. Throws CmfError (or CmfPdfRefused) with nothing saved. */
export async function runCmfPdf(cmf: CmfKit, args: CmfPdfArgs, deps: CmfPdfDeps): Promise<CmfPdfResult> {
  // 1. The upload, its tab and the SKU columns.
  const wb = await deps.loadWorkbook(args.import_id)
  const { spec } = workbookTab(wb, cmf, args.tab)
  const asked = args.sku_columns.map((c) => c.toUpperCase())
  if (new Set(asked).size !== asked.length) throw new CmfError(`a SKU column is named twice: ${asked.join(', ')}`)
  const order = spec.skus.map((s) => s.column)
  for (const col of asked) {
    const sku = spec.skus.find((s) => s.column === col)
    if (!sku) throw new CmfError(`${spec.tab} has no SKU column ${col}; its columns: ${order.join(', ')}`)
    if (sku.in_scope !== true) throw new CmfError(`${spec.tab} column ${col} is not in scope (${String(sku.scope_reason ?? 'no Product Name')})`)
  }
  const columns = [...asked].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  refuseAmbiguousNames(spec, columns)
  if (args.output_ids.length !== columns.length) {
    throw new CmfError(`${columns.length} SKU column(s) and ${args.output_ids.length} render(s): name one approved render per SKU column`)
  }

  // 2. The renders: Claude's, from an upload, approved by the CMF decider.
  const deciders = deciderEmails(cmf)
  if (!deciders.length) {
    throw new CmfError(
      "the product kit names no CMF decider's email, so no render can be shown to carry Damien's yes. The kit's CMF deciders gain an `email` (workstreams/cmf/workstream.json), and a new product-design kit is released."
    )
  }
  const renders = new Map<string, RecordedRender & { decidedBy: string; decidedAt: Date }>()
  for (const id of args.output_ids) {
    const output = await deps.renderOutput(id)
    if (!output) {
      if (await deps.webAttempt(id)) {
        throw new CmfError(`'${id}' is a web CMF Studio attempt: its clown is not recorded, so the legend cannot be shown to come from the key that made it. Render the SKU with cmf_render and import_id, and have Damien answer it.`)
      }
      throw new CmfError(`no Vesper render '${id}'`)
    }
    const r = recorded(output)
    if (collapse(r.tab) !== collapse(spec.tab)) throw new CmfError(`output ${id} is a render of ${r.tab}, not ${spec.tab}`)
    if (!columns.includes(r.column)) throw new CmfError(`output ${id} is a render of ${r.tab} column ${r.column}, which is not among the columns asked (${columns.join(', ')})`)
    if (renders.has(r.column)) throw new CmfError(`two renders for ${spec.tab} column ${r.column}: ${renders.get(r.column)!.output.id} and ${id}; name one`)
    let answer: VerdictRow | null = null
    let by: string | null = null
    for (const v of await deps.verdicts(id, cmf.slug)) {
      const email = ((await deps.verdictEmail(v)) ?? '').trim().toLowerCase()
      const d = deciders.find((x) => x.email === email)
      if (d) {
        answer = v
        by = d.name
        break
      }
    }
    if (!answer) throw new CmfError(`output ${id} (${spec.tab} column ${r.column}) has no answer from ${deciders.map((d) => d.name).join(' or ')} yet: ask for a yes through record_verdict first`)
    if (answer.answer !== 'yes') {
      throw new CmfError(`${by}'s latest answer on output ${id} (${spec.tab} column ${r.column}) is ${answer.answer}${answer.remark ? `: "${answer.remark}"` : ''}. Only a render with a yes goes on a supplier PDF.`)
    }
    renders.set(r.column, { ...r, decidedBy: by!, decidedAt: answer.createdAt })
  }
  for (const col of columns) if (!renders.has(col)) throw new CmfError(`no render named for ${spec.tab} column ${col}`)

  // 3. One clown key, the kit's still, confirmed.
  const keyIds = new Set(Array.from(renders.values()).map((r) => `${r.keyId} ${r.keySha256 ?? '?'}`))
  if (keyIds.size !== 1) throw new CmfError(`the renders were made through different clown keys (${Array.from(keyIds).join('; ')}); one PDF has one part-breakdown page and one legend, so all its renders share one key`)
  const first = renders.get(columns[0])!
  const keyEntry = cmf.keys[first.keyId]
  if (!keyEntry) throw new CmfError(`the clown key '${first.keyId}' the renders were made through is not in this kit any more`)
  if (first.keySha256 && keyEntry.sha256 !== first.keySha256) {
    throw new CmfError(`the clown key '${first.keyId}' changed since the renders were made (it was ${first.keySha256.slice(0, 12)}, the kit has ${keyEntry.sha256.slice(0, 12)}): render again through the key as it is now`)
  }
  const keyFile = JSON.parse((await deps.readKey(keyEntry)).toString('utf8')) as ClownKeyFile
  if (keyEntry.draft || isDraftKey(keyFile)) throw new CmfError(`the clown key '${first.keyId}' is a draft: a zone names no component, so there is no legend`)
  if (!keyFile.confirmed_by) {
    throw new CmfError(`the clown key '${first.keyId}' is not confirmed by Damien (confirmed_by is empty). A supplier PDF's legend comes only from a confirmed key: Damien confirms it on the chips page, and a new kit is released.`)
  }

  // 4. Each render's cells against the upload's cells now.
  for (const col of columns) {
    const r = renders.get(col)!
    const changes = skuSpecChanges(r.skuSpec, skuSpecView(spec, col))
    if (changes.length) {
      const shown = changes
        .slice(0, 12)
        .map((c) => `${c.component} · ${c.field} (${c.cell ?? '?'}): rendered from ${JSON.stringify(c.rendered ?? '')}, the workbook now holds ${JSON.stringify(c.now ?? '')}`)
      throw new CmfError(
        [
          `output ${r.output.id} (${spec.tab} column ${col}) was rendered from cells that have changed since (upload ${r.importId}); render it again from this upload and have Damien answer it:`,
          ...shown.map((s) => `- ${s}`),
          ...(changes.length > 12 ? [`(${changes.length - 12} more)`] : []),
        ].join('\n')
      )
    }
  }

  // 5. Build, read back, check.
  const images: Record<string, SupplierPdfImage> = {}
  for (const col of columns) {
    const r = renders.get(col)!
    try {
      images[col] = await deps.imageBytes(r.output.fileUrl)
    } catch (err) {
      throw new CmfError(`the render ${r.output.id} could not be read (${(err as Error)?.message || 'unknown error'}); nothing was made`)
    }
  }
  const clown = await deps.clownBytes({ id: first.keyId, entry: keyEntry })
  if (!clown) throw new CmfError(`the clown of '${first.keyId}' is not pinned in Vesper (an admin syncs the pins); the part-breakdown page needs it`)
  const built = await buildSupplierPdf({ spec, columns, key: { id: first.keyId, file: keyFile }, renders: images, clown, workbook: wb.info })
  const check = await checkSupplierPdf({ bytes: built.bytes, spec, columns, key: keyFile as ClownKey, workbook: wb.info })
  if (!check.clean) throw new CmfPdfRefused(supplierCheckText(spec, check), check)

  // 6. Saved beside the upload.
  const stamp = deps.now().toISOString().replace(/\D/g, '').slice(0, 14)
  const path = `cmf/${wb.ownerId}/imports/${wb.importId}/pdf/${stamp}/${built.fileName}`
  const url = await deps.storePdf(path, built.bytes)
  return {
    url,
    path,
    file_name: built.fileName,
    import_id: wb.importId,
    tab: spec.tab,
    columns,
    sku_names: Object.fromEntries(columns.map((c) => [c, (spec.skus.find((s) => s.column === c)?.name as string | null | undefined) ?? null])),
    key: { id: first.keyId, sha256: keyEntry.sha256, confirmed_by: String(keyFile.confirmed_by) },
    legend: built.legend,
    pages: built.pages,
    workbook: { file: wb.info.file, sha256: wb.info.sha256, modified: wb.info.modified, modified_source: wb.info.modified_source ?? null, imported_at: wb.importedAt },
    renders: columns.map((c) => {
      const r = renders.get(c)!
      return {
        column: c,
        output_id: r.output.id,
        decided_by: r.decidedBy,
        decided_at: r.decidedAt.toISOString(),
        prompt_sha256: r.promptSha256,
        clown_sha256: r.clownSha256,
        rendered_from_import: r.importId,
      }
    }),
    cells_compared: check.cells_compared,
    rows_compared: check.rows.length,
  }
}
