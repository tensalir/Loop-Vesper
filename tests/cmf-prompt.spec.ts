import { test, expect } from '@playwright/test'
import { buildCmfPrompt, buildPacketFileSlug } from '../src/lib/cmf/prompt'
import type { CmfSkuRow } from '../src/lib/cmf/schema'

/**
 * Unit tests for the deterministic CMF prompt builder. We pin a few
 * properties:
 *   - The prompt always starts with the `Using the attached image` prefix
 *     the Vesper enhance pipeline expects for editing flows.
 *   - Every supplied component appears as a recolour line.
 *   - Components NOT supplied appear in a "Do NOT change" guard line.
 *   - The PDF file slug matches the user-requested pattern.
 */

const FIXTURE: CmfSkuRow = {
  label: 'Switch 2 Sage',
  productSlug: 'switch2',
  variantSlug: 'default',
  productCode: 'SW2-SAGE-001',
  ean: '5400000000017',
  colorwayName: 'Sage',
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
      finish: 'Satin',
    },
  ],
  palette: [],
}

test('buildCmfPrompt starts with the editing-prefix the enhance pipeline expects', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt.startsWith('Using the attached image')).toBe(true)
})

test('buildCmfPrompt names the colourway the model is producing', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('"Sage" colourway')
})

test('buildCmfPrompt emits a recolour line per supplied component', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.componentLines).toHaveLength(2)
  expect(result.componentLines[0]).toContain('POM ring')
  expect(result.componentLines[0]).toContain('PANTONE 17-5641 TCX')
  expect(result.componentLines[1]).toContain('Cosmetic cap')
  // Finish is lower-cased into the prompt phrasing ("satin finish") to read
  // naturally; check insensitively.
  expect(result.componentLines[1].toLowerCase()).toContain('satin')
  expect(result.componentLines[1]).toContain('PC/ABS')
})

test('buildCmfPrompt protects untouched components by name', () => {
  const result = buildCmfPrompt(FIXTURE)
  // Switch 2 has 4 known components; we only set 2, so the other 2 should
  // appear in a "Do NOT change" guard line.
  expect(result.basePrompt).toContain('Do NOT change')
  expect(result.basePrompt).toContain('Silicone tip')
  expect(result.basePrompt).toContain('Mode indicator')
})

test('buildCmfPrompt blocks lifestyle/extra-element drift', () => {
  const result = buildCmfPrompt(FIXTURE)
  expect(result.basePrompt).toContain('Do NOT add logos, text, packaging')
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
