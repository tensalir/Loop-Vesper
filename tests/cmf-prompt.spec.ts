import { test, expect } from '@playwright/test'
import { buildCmfPrompt, buildPacketFileSlug } from '../src/lib/cmf/prompt'
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

test('buildCmfPrompt includes the canonical lighting clause', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('clean studio product photography')
  expect(result.basePrompt).toContain('Soft large key light from upper left')
  expect(result.basePrompt).toContain('contact shadows and ambient occlusion')
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
