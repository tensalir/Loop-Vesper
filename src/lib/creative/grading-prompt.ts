/**
 * The layer-2 grading prompt, assembled from the creative kit alone.
 *
 * A port of `assemble_grading_prompt` in the plugin repository's
 * `tools/kit.py`, which the repository holds to the prompt the product's own
 * `qa.build_grading_prompt` writes (crop off, no stranger read, no
 * measurements: Vesper's read). The words are the kit's
 * (`grading_prompt.text`); only their order lives here, and `docs/kit.md`
 * writes that order out. The kit's conformance file carries fixtures (inputs
 * and the sha256 of the prompt the repository wrote) and one full example; a
 * test holds this function to every one.
 */

import type { KitProduct } from './kit-schema'

export interface GradingReference {
  role: string
  colourway?: string | null
}

export interface MissingReference {
  role: string
  why: string
}

export interface GradingInputs {
  view: string
  asset_class: string
  attached: GradingReference[]
  missing: MissingReference[]
  claim?: string | null
  claim_source?: string | null
  detected?: string | null
  detected_confidence?: string | null
}

export class GradingPromptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GradingPromptError'
  }
}

/** Replace each `{name}` token whose name is given, in one pass; leave every other brace. */
export function fillText(template: string, values: Record<string, string | number>): string {
  const names = Object.keys(values)
  if (names.length === 0) return template
  const pattern = new RegExp(`\\{(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\}`, 'g')
  return template.replace(pattern, (_m, name: string) => String(values[name]))
}

type Words = Record<string, unknown> & { roles: Record<string, string> }

function words(product: KitProduct): Words {
  const gp = product.grading_prompt
  if (!gp) throw new GradingPromptError(`the kit carries no grader for ${product.name} yet`)
  const text = gp.text as Words
  if (!text || typeof text !== 'object' || !text.roles) {
    throw new GradingPromptError(`${product.name}'s grading words are incomplete in the kit`)
  }
  return text
}

function w(T: Words, key: string): string {
  const v = T[key]
  if (typeof v !== 'string') throw new GradingPromptError(`the kit's grading words lack '${key}'`)
  return v
}

export function assembleGradingPrompt(product: KitProduct, inputs: GradingInputs): string {
  const gp = product.grading_prompt!
  const T = words(product)
  const trusted = product.grading?.trusted_claims ?? []
  const p: string[] = [w(T, 'intro'), '', w(T, 'candidate')]
  const first = gp.first_reference_index ?? 2
  inputs.attached.forEach((ref, i) => {
    const role = T.roles[ref.role] ?? w(T, 'role_default')
    const colour = ref.colourway ? fillText(w(T, 'reference_colour'), { colourway: ref.colourway }) : ''
    p.push(fillText(w(T, 'reference'), { n: first + i, colour, role }))
  })
  p.push(w(T, 'references_are_real'))
  if (inputs.missing.length) {
    const items = inputs.missing
      .map((m) => fillText(w(T, 'missing_item'), { role: m.role, why: m.why }))
      .join(w(T, 'missing_separator'))
    p.push(fillText(w(T, 'missing'), { items }))
  }
  if (typeof gp.anatomy !== 'string' || typeof gp.rules !== 'string') {
    throw new GradingPromptError(`${product.name}'s grading words in the kit lack the product sheet or the rules`)
  }
  p.push('', w(T, 'product_heading'), gp.anatomy, '', w(T, 'rules_heading'), gp.rules, '', w(T, 'candidate_heading'))
  p.push(
    fillText(w(T, 'view'), { view: inputs.view }) +
      (inputs.asset_class ? fillText(w(T, 'asset_class'), { asset_class: inputs.asset_class }) : '')
  )
  const claim = inputs.claim ?? null
  const source = inputs.claim_source ?? ''
  const detected = inputs.detected ?? null
  if (claim && trusted.includes(source)) {
    p.push(fillText(w(T, 'claim_trusted'), { claim, source }))
  } else {
    if (claim && source === 'metadata-untrusted') p.push(fillText(w(T, 'claim_untrusted'), { claim }))
    if (detected) {
      p.push(
        fillText(w(T, 'claim_detected'), {
          detected,
          confidence: inputs.detected_confidence || w(T, 'confidence_unstated'),
        })
      )
    } else {
      p.push(w(T, 'claim_none'))
    }
  }
  p.push('', w(T, 'strict'), '', w(T, 'checks_heading'))
  const checks = product.rubric.checks
  for (const c of checks) {
    p.push(fillText(w(T, 'check'), { id: c.id, severity: c.severity, check: c.check, fails_when: c.fails_when }))
  }
  const ids = checks.map((c) => fillText(w(T, 'json_id'), { id: c.id })).join(w(T, 'json_id_separator'))
  p.push('', w(T, 'restate'), '', w(T, 'json_intro'), fillText(w(T, 'json'), { ids: `{${ids}}` }))
  return p.join('\n')
}
