/**
 * What an old CMF Studio write route answers now: 410 Gone, with one line naming where the step
 * went. The read-only routes stay, so the packets and attempts made the old way can be looked at.
 *
 * Why it is here (2026-09-30): the owner ruled that the headless engine is the behaviour in both
 * doors. The web CMF Studio's own prompt (lighting presets, refinement text, a model rewrite), its
 * clown rotation and Replicate fallback, its approve flag, its hand-edited SKU specs, its editable
 * clown library and its unchecked packet PDF are retired for CMF. Every step now goes through the
 * CMF service (`src/lib/creative/cmf/service.ts`) at `/api/cmf/v2/*`, as Claude's tools do. The
 * old tables stay, read only; nothing made the old way goes into a supplier PDF.
 */

import { NextResponse } from 'next/server'

export const MOVED = {
  import:
    "Workbook uploads moved to the CMF Studio's Workbook tab, which reads the export with the same parse as Claude (POST /api/cmf/v2/uploads).",
  packet: 'Packets are no longer made: a render is made from a workbook upload in the Render tab (POST /api/cmf/v2/render).',
  render:
    "Rendering moved to the CMF Studio's Render tab, which sends Damien's template filled by code, with the kit's clown as the only image (POST /api/cmf/v2/render).",
  refine: "Refinement text and reference images are no longer sent: the template goes out as it is. Render in the Render tab (POST /api/cmf/v2/render).",
  approve: 'Approving moved to the Review tab: a yes or no with why, recorded for the whole CMF team (POST /api/cmf/v2/verdict).',
  specs: 'SKU specs are no longer edited in Vesper: they come from the workbook upload. Fix the workbook and upload it again (POST /api/cmf/v2/uploads).',
  clowns: "Clowns and keys come from the product kit and are read only in Vesper: a key changes in the product kit's repository (GET /api/cmf/v2/keys).",
  pdf: 'The packet PDF moved to the PDF tab: the supplier PDF, checked against the workbook before it is saved (POST /api/cmf/v2/pdf).',
  history: 'Packets made the old way are read only; see them in the History tab. Nothing made the old way goes into a supplier PDF.',
} as const

export type MovedStep = keyof typeof MOVED

/** 410 Gone: the step moved; the body names where. */
export function retired(step: MovedStep): NextResponse {
  return NextResponse.json({ error: MOVED[step], moved: step }, { status: 410 })
}
