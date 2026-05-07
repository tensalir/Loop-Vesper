import { test, expect } from '@playwright/test'
import { buildCmfPacketPdf } from '../src/lib/cmf/pdf'

/**
 * Smoke test for the CMF PDF builder. We don't try to compare visual output —
 * just confirm the build completes, returns a valid PDF magic header, and
 * exercises both the single-SKU and multi-SKU branches.
 */

const SINGLE_RENDER = {
  id: '00000000-0000-0000-0000-000000000001',
  label: 'Switch 2 Sage',
  colorwayName: 'Sage',
  productSlug: 'switch2',
  productCode: 'SW2-SAGE-001',
  ean: '5400000000017',
  componentSpecs: [
    {
      region: 'pom_ring',
      label: 'POM ring',
      pantone: 'PANTONE 17-5641 TCX',
      colorHex: '#7ba47a',
      material: 'POM',
      finish: 'Matte',
    },
  ],
  paletteSwatches: [],
  renderUrl: null,
  enhancedPrompt: null,
  status: 'ready',
}

function pdfHeader(bytes: Uint8Array): string {
  // Avoid spread syntax over Uint8Array so this compiles under the
  // tsconfig target the rest of the repo uses.
  return Buffer.from(bytes.slice(0, 5)).toString('utf8')
}

test('buildCmfPacketPdf returns valid PDF bytes for a single SKU', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Sage',
    cmfCode: 'CMF-001234revA',
    notes: 'Spring 2026 launch',
    renders: [SINGLE_RENDER as any],
  })
  expect(pdf.length).toBeGreaterThan(500)
  expect(pdfHeader(pdf)).toBe('%PDF-')
})

test('buildCmfPacketPdf adds a breakdown page for multi-SKU packets', async () => {
  const renders = [
    SINGLE_RENDER,
    {
      ...SINGLE_RENDER,
      id: '00000000-0000-0000-0000-000000000002',
      label: 'Switch 2 Boreas',
      colorwayName: 'Boreas',
    },
    {
      ...SINGLE_RENDER,
      id: '00000000-0000-0000-0000-000000000003',
      label: 'Switch 2 Aphrodite',
      colorwayName: 'Aphrodite',
    },
  ]
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 4-Pack',
    cmfCode: 'CMF-001234revA',
    notes: 'Includes shared breakdown page',
    renders: renders as any,
  })
  expect(pdf.length).toBeGreaterThan(500)
  expect(pdfHeader(pdf)).toBe('%PDF-')
})
