/**
 * What each CMF step takes, one schema for both doors: Claude's tools (`src/lib/headless/tools/cmf.ts`)
 * and the web CMF Studio's routes (`web-door.ts`, `src/app/api/cmf/v2/*`) parse their arguments
 * with these, so a door cannot accept what the other refuses.
 *
 * Why it is here (2026-09-30): the schemas lived in the Claude door. The web door calls the same
 * service (`service.ts`) and was about to write its own copy; moved here unchanged, so both
 * parse the same way and `tests/cmf-parity.spec.ts` holds them to one answer.
 */

import { z } from 'zod'
import { MAX_RUNS } from '@/lib/creative/grade'

export const CmfListArgs = z.object({ tab: z.string().min(1).max(80).optional() }).strict()

export const CmfTargetArgs = {
  tab: z.string().min(1).max(80),
  column: z.string().regex(/^[A-Za-z]{1,2}$/, 'a column letter'),
  clown: z.string().min(1).max(120),
}

export const CmfPromptArgs = z.object(CmfTargetArgs).strict()

/** A SKU of a workbook upload, by identifiers only. */
export const CmfWorkbookTargetArgs = {
  import_id: z.string().uuid(),
  tab: z.string().min(1).max(80),
  sku_column: z.string().regex(/^[A-Za-z]{1,2}$/, 'a column letter'),
  clown: z.string().min(1).max(120),
}

export const CmfWorkbookPromptArgs = z.object(CmfWorkbookTargetArgs).strict()
export const WORKBOOK_TARGET_KEYS = ['import_id', 'tab', 'sku_column', 'clown'] as const

const RenderOptions = {
  lane: z.enum(['final', 'draft']).optional(),
  n: z.number().int().min(1).max(4).optional(),
  image_size: z.enum(['1K', '2K', '4K']).optional(),
  async: z.boolean().optional().default(false),
}

export const CmfRenderArgs = z.object({ ...CmfTargetArgs, ...RenderOptions }).strict()

export const CmfWorkbookRenderArgs = z.object({ ...CmfWorkbookTargetArgs, ...RenderOptions }).strict()
export const WORKBOOK_RENDER_KEYS = [...WORKBOOK_TARGET_KEYS, 'lane', 'n', 'image_size', 'async'] as const

export const CmfCheckPdfArgs = z
  .object({
    pdf_url: z.string().url().max(2000).optional(),
    cmf_packet_id: z.string().uuid().optional(),
    tab: z.string().min(1).max(80),
    columns: z.array(z.string().min(1).max(80)).max(20).optional(),
    layout: z.enum(['vesper', 'ours']).optional().default('vesper'),
    clown: z.string().min(1).max(120).optional(),
    engine: z.enum(['vesper', 'worker']).optional().default('vesper'),
  })
  .strict()
  .refine((a) => !!a.pdf_url !== !!a.cmf_packet_id, 'name the PDF by pdf_url or by cmf_packet_id, one of them')

export const CmfPdfArgs = z
  .object({
    import_id: z.string().uuid(),
    tab: z.string().min(1).max(80),
    sku_columns: z.array(z.string().regex(/^[A-Za-z]{1,2}$/, 'a column letter')).min(1).max(20),
    output_ids: z.array(z.string().uuid()).min(1).max(20),
  })
  .strict()
export const PDF_KEYS = ['import_id', 'tab', 'sku_columns', 'output_ids'] as const

/**
 * A grade of one of the team's CMF renders, as the web asks for it: the render by output id, and
 * the upload its row is read from (a render made from an upload records its tab, column and key).
 * grade_image takes the same fields for product cmf, among its others.
 */
export const CmfGradeArgs = z
  .object({
    output_id: z.string().uuid(),
    import_id: z.string().uuid().optional(),
    tab: z.string().max(80).optional(),
    column: z.string().max(4).optional(),
    clown: z.string().max(120).optional(),
    runs: z.number().int().min(1).max(MAX_RUNS).optional(),
  })
  .strict()

/** A yes or no on one of the team's CMF renders, with why: record_verdict's CMF fields. */
export const CmfVerdictArgs = z
  .object({
    output_id: z.string().uuid(),
    grade_id: z.string().uuid().optional(),
    answer: z.enum(['yes', 'no']),
    remark: z.string().max(2000).optional().default(''),
  })
  .strict()
