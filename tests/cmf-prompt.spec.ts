import { test, expect } from '@playwright/test'
import {
  buildCmfPrompt,
  buildPacketFileSlug,
  PROMPT_VARIANTS,
  selectPromptVariant,
} from '../src/lib/cmf/prompt'
import type { CmfSkuRow } from '../src/lib/cmf/schema'

/**
 * Unit tests for the deterministic CMF prompt builder. The canonical
 * reference is the prompt Damien hand-tuned on Nano Banana
 * (`src/lib/skills/loop-cmf-generation/references/prompting.md`). These
 * tests pin the structural pieces of that prompt so future changes don't
 * silently drift away from what we know works.
 */

const FIXTURE: CmfSkuRow = {
  label: 'Switch 2 Teal',
  productSlug: 'switch2',
  variantSlug: 'default',
  productCode: 'SW2-TEAL-001',
  ean: '5400000000017',
  colorwayName: 'Teal',
  cmfCode: 'CMF-001234revA',
  components: [
    {
      region: 'pom_ring',
      label: 'POM ring',
      pantone: 'PANTONE 17-5641 TCX',
      colorHex: '#7ba47a',
      material: 'POM',
      finish: 'Matte',
    },
    {
      region: 'cosmetic_cap',
      label: 'Cosmetic cap',
      pantone: 'PANTONE 11-0602 TCX',
      material: 'PC/ABS',
      finish: 'NCVM Satin',
    },
  ],
  palette: [],
}

test('buildCmfPrompt opens with the canonical clown-render framing', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toMatch(/^Using the provided 3D clown CMF render of /)
  expect(result.basePrompt).toContain('photorealistic studio product shot')
})

test('buildCmfPrompt names the colourway the model is producing', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('"Teal" colourway')
})

test('buildCmfPrompt carries the preserve clause verbatim', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Preserve the geometry, design, angle, framing, composition')
  expect(result.basePrompt).toContain('Keep any text, markings, or labels')
  expect(result.basePrompt).toContain('Keep the source background unchanged')
})

test('buildCmfPrompt emits a recolour line per supplied component with rich vocabulary', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.componentLines).toHaveLength(2)

  // POM line carries the verbatim material plus a texture hint.
  expect(result.componentLines[0]).toContain('POM ring')
  expect(result.componentLines[0]).toContain('PANTONE 17-5641 TCX')
  expect(result.componentLines[0]).toMatch(/POM \(.*micro-texture.*\)/)

  // NCVM Satin cap line should pick the anodised-metal vocabulary.
  expect(result.componentLines[1]).toContain('Cosmetic cap')
  expect(result.componentLines[1]).toContain('PC/ABS')
  expect(result.componentLines[1].toLowerCase()).toContain('ncvm-coated')
  expect(result.componentLines[1].toLowerCase()).toContain('anisotropic')
})

test('buildCmfPrompt protects untouched components by name', () => {
  const result = buildCmfPrompt(FIXTURE)
  // Switch 2 has 5 known components in the catalog; we set 2, so the other 3
  // should appear in a "Do NOT change" guard line.
  expect(result.basePrompt).toContain('Do NOT change')
  expect(result.basePrompt).toContain('Eartip (hidden flange)')
  expect(result.basePrompt).toContain('Nozzle piece + retention ring')
  expect(result.basePrompt).toContain('Artwork')
})

test('buildCmfPrompt defaults to Studio Classic when no variant index is passed', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.variant.id).toBe('classic')
  expect(result.basePrompt).toContain('Soft large key light from upper left')
  expect(result.basePrompt).toContain('contact shadows and ambient occlusion')
})

test('buildCmfPrompt swaps the lighting clause when variantIndex changes', () => {
  const classic = buildCmfPrompt(FIXTURE, { variantIndex: 0 })
  const warm = buildCmfPrompt(FIXTURE, { variantIndex: 1 })
  const clinical = buildCmfPrompt(FIXTURE, { variantIndex: 2 })
  const dramatic = buildCmfPrompt(FIXTURE, { variantIndex: 3 })

  expect(classic.variant.id).toBe('classic')
  expect(warm.variant.id).toBe('warm')
  expect(clinical.variant.id).toBe('clinical')
  expect(dramatic.variant.id).toBe('dramatic')

  // The lighting clauses should be meaningfully different — at minimum each
  // one mentions wording the others don't.
  expect(warm.basePrompt).toContain('warm bias')
  expect(clinical.basePrompt).toContain('Crisp neutral key light from directly above')
  expect(dramatic.basePrompt).toContain('Single hard key light')

  // The preserve clause and quality bar stay LOCK across all variants.
  for (const v of [classic, warm, clinical, dramatic]) {
    expect(v.basePrompt).toContain('Preserve the geometry, design, angle, framing')
    expect(v.basePrompt).toContain('Output should look like a real photographed sample')
  }
})

test('selectPromptVariant cycles via modulo so any attempt number maps to a real variant', () => {
  expect(PROMPT_VARIANTS.length).toBeGreaterThanOrEqual(3)
  expect(selectPromptVariant(0).id).toBe('classic')
  expect(selectPromptVariant(PROMPT_VARIANTS.length).id).toBe('classic')
  expect(selectPromptVariant(PROMPT_VARIANTS.length + 1).id).toBe(
    PROMPT_VARIANTS[1].id
  )
  // Negative indices fold back cleanly.
  expect(selectPromptVariant(-1).id).toBe(
    PROMPT_VARIANTS[PROMPT_VARIANTS.length - 1].id
  )
})

test('buildCmfPrompt ends with the photographed-not-CGI quality bar', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Photorealistic 4K product render quality')
  expect(result.basePrompt.trim()).toMatch(
    /real photographed sample, not a CGI render\.$|real photographed sample, not a CGI render\.\n?Designer notes:/m
  )
})

test('buildCmfPrompt picks translucent silicone vocabulary for Shore 30 / milky finish', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'body_outer',
        label: 'Body — Outer',
        pantone: 'PANTONE 14-4313 TCX',
        material: 'Silicone - Shore 30',
        finish: 'VDI 18',
      },
    ],
  })
  expect(result.componentLines[0].toLowerCase()).toContain('translucent milky silicone')
  expect(result.componentLines[0].toLowerCase()).toContain('subsurface light scattering')
})

test('buildCmfPrompt picks polished-aluminium vocabulary for mirror finish on AL6063', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'aglet_part_1',
        label: 'Aglet - Part 1',
        pantone: 'PANTONE 7720 C',
        material: 'Aluminum - AL6063',
        finish: 'Polished mirror',
      },
    ],
  })
  expect(result.componentLines[0].toLowerCase()).toContain('polished mirror')
})

test('buildCmfPrompt flags iridescent finishes as embedded, not painted on top', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'cosmetic_cap',
        label: 'Cosmetic cap',
        pantone: 'PANTONE 17-5641 TCX',
        material: 'PC/ABS',
        finish: 'Iridescent',
      },
    ],
  })
  expect(result.componentLines[0]).toContain(
    'embedded in the material, not painted on top'
  )
})

test('buildCmfPrompt throws for unknown product slugs', () => {
  expect(() =>
    buildCmfPrompt({
      ...FIXTURE,
      productSlug: 'galaxy_brain',
    })
  ).toThrow(/Unknown CMF product/i)
})

test('buildPacketFileSlug matches the requested CMF naming pattern', () => {
  const slug = buildPacketFileSlug({
    cmfCode: 'CMF-001234revA',
    productSlug: 'switch2',
    colorwayName: 'Sage',
  })
  expect(slug).toBe('CMF-001234revA_LoopSwitch2_CMF_Sage')
})

/* ── Clown region addressing ──────────────────────────────────────────── */

test('buildCmfPrompt anchors component lines on the clown reference colour when metadata is available', () => {
  const result = buildCmfPrompt(FIXTURE, {
    clownComponents: [
      { region: 'pom_ring', label: 'POM ring', colorHex: '#ff3344' },
      { region: 'cosmetic_cap', label: 'Cosmetic cap', colorHex: '#3366ff' },
    ],
  })

  // POM ring is anchored to "red" (#ff3344) and Cosmetic cap to "blue" (#3366ff).
  expect(result.componentLines[0]).toContain('POM ring (the red surface on the reference)')
  expect(result.componentLines[1]).toContain('Cosmetic cap (the blue surface on the reference)')

  // The reference legend appears once, with both entries.
  expect(result.basePrompt).toContain('Clown reference legend')
  expect(result.basePrompt).toContain('red → POM ring')
  expect(result.basePrompt).toContain('blue → Cosmetic cap')
})

test('buildCmfPrompt falls back to label-only addressing when no clown metadata is given', () => {
  const result = buildCmfPrompt(FIXTURE)
  // No "on the reference" qualifier and no legend line.
  expect(result.componentLines[0]).not.toContain('on the reference')
  expect(result.basePrompt).not.toContain('Clown reference legend')
})

test('buildCmfPrompt skips clown legend entries without a colour hex', () => {
  const result = buildCmfPrompt(FIXTURE, {
    clownComponents: [
      { region: 'pom_ring', label: 'POM ring', colorHex: null },
      { region: 'cosmetic_cap', label: 'Cosmetic cap' },
    ],
  })
  expect(result.basePrompt).not.toContain('Clown reference legend')
  expect(result.componentLines[0]).not.toContain('surface on the reference')
})

/* ── Palette context ──────────────────────────────────────────────────── */

test('buildCmfPrompt surfaces palette context when palette swatches are supplied', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    palette: [
      { label: 'Accent', pantone: 'PANTONE 7720 C' },
      { label: 'Lining', colorHex: '#3366ff' },
    ],
  })
  expect(result.basePrompt).toContain('Overall CMF palette context')
  expect(result.basePrompt).toContain('Accent → PANTONE 7720 C')
  expect(result.basePrompt).toContain('Lining → #3366ff')
  // Palette is context, not extra surfaces — make sure the prompt says so.
  expect(result.basePrompt).toContain('not extra surfaces to recolour')
})

test('buildCmfPrompt omits palette block when no swatches are supplied', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).not.toContain('Overall CMF palette context')
})

/* ── Material / finish vocabulary for Damien's Switch 2 pack ──────────── */

test('buildCmfPrompt promotes matte POM with the deep-matte engineering wording', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'pom_ring',
        label: 'POM ring',
        pantone: 'Pantone 7720C',
        material: 'POM',
        finish: 'Matte',
      },
    ],
  })
  expect(result.componentLines[0].toLowerCase()).toContain('deeply matte engineering plastic')
  expect(result.componentLines[0].toLowerCase()).toContain('completely diffuse')
})

test('buildCmfPrompt distinguishes glossy ABS from NCVM metallic on ABS', () => {
  const glossy = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'cosmetic_cap',
        label: 'Cosmetic cap',
        pantone: 'Pantone 155C',
        material: 'ABS',
        finish: 'glossy',
      },
    ],
  })
  const ncvm = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'cosmetic_cap',
        label: 'Cosmetic cap',
        pantone: 'Pantone 155C',
        material: 'ABS',
        finish: 'NCVM Satin',
      },
    ],
  })
  expect(glossy.componentLines[0].toLowerCase()).toContain('high-gloss')
  expect(glossy.componentLines[0].toLowerCase()).toContain('clearly a polished plastic')
  expect(ncvm.componentLines[0].toLowerCase()).toContain('ncvm-coated')
  expect(ncvm.componentLines[0].toLowerCase()).toContain('anodised aluminium')
})

test('buildCmfPrompt expands VDI 21 into deep matte injection-mould vocabulary', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'nozzle_piece',
        label: 'Nozzle piece + retention ring',
        pantone: 'Pantone 726C',
        material: 'ABS',
        finish: 'VDI 21',
      },
    ],
  })
  expect(result.componentLines[0]).toContain('VDI 21')
  expect(result.componentLines[0].toLowerCase()).toContain('deep matte')
  expect(result.componentLines[0].toLowerCase()).toContain('injection-mould grain')
})

test('buildCmfPrompt translates "Milky see through 30%" into a calibrated translucent silicone clause', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'eartip',
        label: 'Eartip (hidden flange)',
        pantone: 'Pantone 7720C',
        material: 'Silicone',
        finish: 'Milky see through 30%',
      },
    ],
  })
  expect(result.componentLines[0].toLowerCase()).toContain('30% light transmission')
  expect(result.componentLines[0].toLowerCase()).toContain('frosted appearance')
  expect(result.componentLines[0].toLowerCase()).not.toContain('roughly 100% light transmission')
})

test('buildCmfPrompt ends with a material-fidelity quality bar so finish stays first-class', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Material fidelity is critical')
})

/* ── Colour fidelity (Damien's "colors are off" feedback) ─────────────── */

test('buildCmfPrompt opens with a disclaimer that the clown reference colours are LABELS, not targets', () => {
  const result = buildCmfPrompt(FIXTURE)
  // The disclaimer should sit early in the prompt — before the recolour
  // block — so the model has the negative constraint primed before
  // committing to a colour intent.
  expect(result.basePrompt).toContain('LABELS, not the target palette')
  expect(result.basePrompt).toContain(
    'none of the clown\'s identifier colours may appear on the final product'
  )
  // Position check: the disclaimer must precede the per-component recolour block.
  const disclaimerAt = result.basePrompt.indexOf('LABELS, not the target palette')
  const recolourAt = result.basePrompt.indexOf('Replace only the materials')
  expect(disclaimerAt).toBeGreaterThan(0)
  expect(recolourAt).toBeGreaterThan(disclaimerAt)
})

test('buildCmfPrompt leads each component line with the hex value before the Pantone code', () => {
  // When both hex and Pantone are present, the hex must come first inside
  // the TARGET COLOUR clause — VLMs parse hex literally; Pantone is
  // opaque text for them. Keeping both means the factory still has the
  // canonical Pantone reference.
  const result = buildCmfPrompt(FIXTURE)
  // POM ring fixture: pantone "PANTONE 17-5641 TCX", colorHex "#7ba47a".
  expect(result.componentLines[0]).toContain('TARGET COLOUR #7ba47a (PANTONE 17-5641 TCX)')
})

test('buildCmfPrompt falls back to Pantone-only when colorHex is missing', () => {
  const result = buildCmfPrompt({
    ...FIXTURE,
    components: [
      {
        region: 'pom_ring',
        label: 'POM ring',
        pantone: 'PANTONE 17-5641 TCX',
        material: 'POM',
        finish: 'Matte',
      },
    ],
  })
  expect(result.componentLines[0]).toContain('TARGET COLOUR PANTONE 17-5641 TCX')
  expect(result.componentLines[0]).not.toContain('TARGET COLOUR #')
})

test('buildCmfPrompt emits a Final colour palette recap with every per-component target', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Final colour palette')
  expect(result.basePrompt).toContain(
    'these are the ONLY colours that may appear on the recoloured surfaces'
  )
  // Both components show up in the recap, in order.
  const recapStart = result.basePrompt.indexOf('Final colour palette')
  const pomAt = result.basePrompt.indexOf('POM ring →', recapStart)
  const capAt = result.basePrompt.indexOf('Cosmetic cap →', recapStart)
  expect(pomAt).toBeGreaterThan(recapStart)
  expect(capAt).toBeGreaterThan(pomAt)
})

test('buildCmfPrompt places the Final colour palette recap right before the lighting clause', () => {
  // Sequence ordering pins how the prompt reads top-to-bottom: recolour
  // block → palette context → final recap → lighting → quality bar. The
  // recap belongs late so it stays in attention when the model commits.
  const result = buildCmfPrompt(FIXTURE)
  const recapAt = result.basePrompt.indexOf('Final colour palette')
  const lightingAt = result.basePrompt.indexOf('Lighting:')
  expect(recapAt).toBeGreaterThan(0)
  expect(lightingAt).toBeGreaterThan(recapAt)
})

test('buildCmfPrompt closes with a colour-fidelity quality bar alongside the material-fidelity one', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Colour fidelity is equally critical')
  expect(result.basePrompt).toContain(
    'must read as its specified hex/Pantone target'
  )
  expect(result.basePrompt).toContain(
    'NOT as the saturated identifier colour from the clown reference'
  )
})
