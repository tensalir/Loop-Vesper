/**
 * A CMF payload built by code from a workbook upload: the same shape as the payloads the product
 * repository commits (`prompt_build.py`), plus where its values came from. The prompt is filled
 * from the upload's cells and the kit's clown key and template (`prompt-fill.ts`); nothing a
 * model wrote is in it.
 *
 * What a render made from it records, so a PDF can hold the render to the workbook later: the
 * import id and the workbook's sha256, the SKU's cells as parsed (`sku_spec`) and their sha256,
 * the key's sha256, the prompt's sha256 and the clown's.
 */

import { CmfError, resolveKey, type CmfKey, type CmfKit } from './kit-cmf'
import { fillPrompt, readTemplateBlock, skuSpecSha256, skuSpecView, type ClownKeyFile, type FilledPrompt, type SkuSpecView } from './prompt-fill'
import type { CmfPayload } from './render'
import { workbookTab, type StoredWorkbook } from './workbook-source'

export interface WorkbookProvenance {
  import_id: string
  file: string
  sha256: string
  modified: string | null
  modified_source: string | null
  imported_at: string
  tab: string
  column: string
  sku_spec: SkuSpecView
  sku_spec_sha256: string
}

export interface WorkbookPayload extends CmfPayload {
  key: { id: string; sha256: string; confirmed_by: string | null; confirmed_at: string | null }
  key_confirmed: boolean
  lines: FilledPrompt['lines']
  omitted: FilledPrompt['omitted']
  warnings: string[]
  workbook: WorkbookProvenance
}

/** `import:<id>:<tab slug>:<column>:<key>`, the id a workbook render's plan carries. */
export function workbookPayloadId(importId: string, kitSlug: string, column: string, keyId: string): string {
  return `import:${importId}:${kitSlug}--${column.toUpperCase()}--${keyId}`
}

function baseName(p: string): string {
  return p.split('/').pop() || p
}

/**
 * The payload for one SKU column of one tab of an upload, through one clown key of the kit, or a
 * refusal naming why: a tab or key the kit does not have, a key of another product, a draft key,
 * a column not in the tab or not in scope, a template that is not the kit's, or everything
 * prompt_build.py refuses (`PromptRefusal`, every reason).
 */
export async function buildWorkbookPayload(args: {
  cmf: CmfKit
  wb: StoredWorkbook
  tab: string
  column: string
  keyId: string
  readKey: (entry: CmfKey) => Promise<Buffer>
}): Promise<{ payload: WorkbookPayload; payloadId: string; keyEntry: CmfKey; keyFile: ClownKeyFile; filled: FilledPrompt; kitSlug: string }> {
  const { cmf, wb } = args
  const { spec, kitSlug } = workbookTab(wb, cmf, args.tab)
  const keyEntry = resolveKey(cmf, cmf.specs[kitSlug], args.keyId)
  if (keyEntry.draft) {
    throw new CmfError(
      `the clown key '${args.keyId}' is a draft: a zone names no component yet. Damien names the zones (the chips page), then the prompt is built. No prompt is sent from a draft key.`
    )
  }
  const column = args.column.toUpperCase()
  const sku = spec.skus.find((s) => s.column === column)
  if (!sku) throw new CmfError(`${spec.tab} has no SKU column ${column}; its columns: ${spec.skus.map((s) => s.column).join(', ')}`)
  if (sku.in_scope !== true) {
    throw new CmfError(`${spec.tab} column ${column} is not in scope (${String(sku.scope_reason ?? 'no Product Name')}): fill its Product Name in the sheet first`)
  }
  if (!cmf.template) throw new CmfError('the kit carries no CMF template')
  const template = readTemplateBlock(cmf.template.block)
  if (template.sha256 !== cmf.template.block_sha256) {
    throw new CmfError(`the kit's CMF template block hashes to ${template.sha256.slice(0, 12)}, the kit says ${cmf.template.block_sha256.slice(0, 12)}: the kit is damaged`)
  }
  const keyBytes = await args.readKey(keyEntry)
  const keyFile = JSON.parse(keyBytes.toString('utf8')) as ClownKeyFile
  const filled = fillPrompt(spec, column, keyFile, template, baseName(keyEntry.path))
  if (keyEntry.clown?.sha256 && filled.clown.sha256 && keyEntry.clown.sha256 !== filled.clown.sha256) {
    throw new CmfError(`the key file's clown is ${filled.clown.sha256.slice(0, 12)}, the kit's is ${keyEntry.clown.sha256.slice(0, 12)}: the kit is damaged`)
  }
  const view = skuSpecView(spec, column)
  const payload: WorkbookPayload = {
    schema: 1,
    tab: filled.tab,
    column: filled.column,
    sku_name: filled.sku_name,
    sku_id: filled.sku_id,
    product_slug: filled.product_slug,
    key: { id: args.keyId, sha256: keyEntry.sha256, confirmed_by: keyFile.confirmed_by ?? null, confirmed_at: keyFile.confirmed_at ?? null },
    key_confirmed: filled.key_confirmed,
    clown: { id: filled.clown.id ?? args.keyId, sha256: filled.clown.sha256 ?? '', width: filled.clown.width, height: filled.clown.height, aspect: filled.clown.aspect },
    template_sha256: filled.template_sha256,
    prompt: filled.prompt,
    prompt_sha256: filled.prompt_sha256,
    lines: filled.lines,
    omitted: filled.omitted,
    image: { sha256: filled.clown.sha256 ?? undefined, count: 1 },
    warnings: filled.warnings,
    workbook: {
      import_id: wb.importId,
      file: wb.fileName,
      sha256: wb.info.sha256 ?? '',
      modified: wb.info.modified,
      modified_source: wb.info.modified_source ?? null,
      imported_at: wb.importedAt,
      tab: spec.tab,
      column,
      sku_spec: view,
      sku_spec_sha256: skuSpecSha256(view),
    },
  }
  return { payload, payloadId: workbookPayloadId(wb.importId, kitSlug, column, args.keyId), keyEntry, keyFile, filled, kitSlug }
}
