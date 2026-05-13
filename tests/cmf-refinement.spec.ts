import { test, expect } from '@playwright/test'
import {
  applyRefinementToPrompt,
  pickVariantIndex,
} from '../src/lib/cmf/render'

/**
 * Pin the iterative-refinement prompt scaffolding + variant rules.
 * These are pure helpers extracted from `runCmfRender` precisely so
 * the contract can be tested without spinning up Prisma or the
 * model adapter — the spec wraps the surface area Damien actually
 * cares about: "the correction got into the prompt, and the
 * lighting didn't shift on me at the same time."
 */

const SPEC_PROMPT =
  'A pair of Loop Aphrodite earplugs, studio-lit hero render, neutral background. Top housing: PC/ABS, High-gloss mirror polish.'

test('applyRefinementToPrompt is a no-op when no refinement is provided', () => {
  expect(applyRefinementToPrompt(SPEC_PROMPT)).toBe(SPEC_PROMPT)
  expect(applyRefinementToPrompt(SPEC_PROMPT, undefined)).toBe(SPEC_PROMPT)
  expect(applyRefinementToPrompt(SPEC_PROMPT, null)).toBe(SPEC_PROMPT)
  expect(applyRefinementToPrompt(SPEC_PROMPT, '')).toBe(SPEC_PROMPT)
  expect(applyRefinementToPrompt(SPEC_PROMPT, '   ')).toBe(SPEC_PROMPT)
})

test('applyRefinementToPrompt appends a REFINEMENT INSTRUCTIONS section', () => {
  const out = applyRefinementToPrompt(
    SPEC_PROMPT,
    'make the black more holographic'
  )
  // The spec is preserved verbatim.
  expect(out.startsWith(SPEC_PROMPT)).toBe(true)
  // The correction is named explicitly with the label the model will key on.
  expect(out).toContain('REFINEMENT INSTRUCTIONS:')
  expect(out).toContain('make the black more holographic')
  // The closing reminder is present so the model preserves spec details.
  expect(out).toContain('preserving every other spec detail above')
})

test('applyRefinementToPrompt trims whitespace from the correction', () => {
  const out = applyRefinementToPrompt(
    SPEC_PROMPT,
    '   warmer chrome accent   '
  )
  // Trimmed: no leading/trailing whitespace bleeds into the prompt.
  expect(out).toContain('not fully capture: warmer chrome accent\n')
})

test('pickVariantIndex defaults to attemptNumber - 1 (bulk burst path)', () => {
  expect(
    pickVariantIndex({ attemptNumber: 1, isRefinement: false })
  ).toBe(0)
  expect(
    pickVariantIndex({ attemptNumber: 4, isRefinement: false })
  ).toBe(3)
  // Bulk burst with no parent: variant cycles through 0, 1, 2, 3, ...
  // mod-4 happens downstream in selectPromptVariant.
})

test('pickVariantIndex reuses the parent variant when refining', () => {
  // Refining attempt #3 → must reuse variant index 2 even though
  // the new attempt is #5. This is the "lighting doesn't drift on
  // a refinement" guarantee.
  expect(
    pickVariantIndex({
      attemptNumber: 5,
      parentAttemptNumber: 3,
      isRefinement: true,
    })
  ).toBe(2)
})

test('pickVariantIndex falls back to attemptNumber - 1 when refining without a parent', () => {
  // Fresh-spec refinement (no anchor) is still valid — the prompt
  // gets the spec + correction, and we pick the variant from the
  // new attempt number. Tested explicitly so we don't accidentally
  // crash when parentAttemptNumber is null.
  expect(
    pickVariantIndex({
      attemptNumber: 5,
      parentAttemptNumber: null,
      isRefinement: true,
    })
  ).toBe(4)
})

test('applyRefinementToPrompt does NOT mention references when count is 0', () => {
  // Bulk burst path (no refs) must not start hallucinating a
  // REFERENCE IMAGES section. Pinning this means a careless tweak
  // to the helper can't silently start telling the model about
  // images that don't exist.
  const out = applyRefinementToPrompt(SPEC_PROMPT, 'tone it down', 0)
  expect(out).toContain('REFINEMENT INSTRUCTIONS:')
  expect(out).not.toContain('REFERENCE IMAGES:')
})

test('applyRefinementToPrompt appends a REFERENCE IMAGES section when count > 0', () => {
  const out = applyRefinementToPrompt(SPEC_PROMPT, 'more chrome accent', 2)
  expect(out).toContain('REFINEMENT INSTRUCTIONS:')
  expect(out).toContain('REFERENCE IMAGES:')
  // The exact ref count is named so the model knows how many to
  // expect alongside the canonical reference.
  expect(out).toContain('2 reference images')
  // Each ref is enumerated explicitly so the model can ground its
  // attention.
  expect(out).toContain('Reference 1: refinement guidance.')
  expect(out).toContain('Reference 2: refinement guidance.')
})

test('applyRefinementToPrompt singularises the REFERENCE IMAGES copy', () => {
  // Smaller surface, but worth pinning: copy reads naturally with
  // exactly one reference attached.
  const out = applyRefinementToPrompt(SPEC_PROMPT, 'tighter highlights', 1)
  expect(out).toContain('1 reference image alongside')
  expect(out).toContain('Treat it as guidance')
  expect(out).toContain('Reference 1: refinement guidance.')
  expect(out).not.toContain('Reference 2:')
})

test('applyRefinementToPrompt can attach references even without a refinement prompt', () => {
  // Designers sometimes only attach references and skip the
  // textual correction (the references *are* the correction). The
  // helper still scaffolds the references section in that case so
  // the model gets the same context.
  const out = applyRefinementToPrompt(SPEC_PROMPT, undefined, 1)
  expect(out.startsWith(SPEC_PROMPT)).toBe(true)
  expect(out).not.toContain('REFINEMENT INSTRUCTIONS:')
  expect(out).toContain('REFERENCE IMAGES:')
})

test('refinement is grounded in the spec, not the parent prompt', () => {
  // This is the most important behavioural guarantee: refining never
  // takes a prior attempt's text as context. We reconstruct what
  // happens in runCmfRender — call buildCmfPrompt-equivalent (here
  // represented by SPEC_PROMPT) with the variant index, then layer
  // the refinement on top. So even after 5 hops, the spec is still
  // the foundation.
  const r1 = applyRefinementToPrompt(SPEC_PROMPT, 'more matte')
  const r2 = applyRefinementToPrompt(SPEC_PROMPT, 'cooler tone')
  // Each refinement starts from the spec, not from the prior refinement.
  expect(r1.startsWith(SPEC_PROMPT)).toBe(true)
  expect(r2.startsWith(SPEC_PROMPT)).toBe(true)
  // The two refinements differ ONLY in the correction text.
  expect(r1).not.toBe(r2)
  expect(r1.replace('more matte', 'cooler tone')).toBe(r2)
})
