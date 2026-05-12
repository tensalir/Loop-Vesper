import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { buildCmfPacketPdf, CMF_PDF_GEOMETRY } from '../src/lib/cmf/pdf'

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

/* ── Source-template structure (Damien's Loop CMF deck) ─────────────── */

test('buildCmfPacketPdf renders A4 portrait pages, matching the source CMF deck', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Emerald',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: [SINGLE_RENDER as any],
  })
  const doc = await PDFDocument.load(pdf)
  const page = doc.getPage(0)
  const size = page.getSize()
  // A4 portrait: 595 × 842 pt — Damien's source template orientation.
  expect(Math.round(size.width)).toBe(CMF_PDF_GEOMETRY.PAGE_W)
  expect(Math.round(size.height)).toBe(CMF_PDF_GEOMETRY.PAGE_H)
  expect(size.height).toBeGreaterThan(size.width)
})

test('buildCmfPacketPdf produces two pages per SKU (render + part breakdown)', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Emerald',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: [SINGLE_RENDER as any],
  })
  const doc = await PDFDocument.load(pdf)
  expect(doc.getPageCount()).toBe(2)
})

test('buildCmfPacketPdf appends a pack overview page for multi-SKU packets', async () => {
  const renders = [
    SINGLE_RENDER,
    {
      ...SINGLE_RENDER,
      id: '00000000-0000-0000-0000-000000000002',
      label: 'Switch 2 Gold',
      colorwayName: 'Gold',
    },
  ]
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Spring 2026',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: renders as any,
  })
  const doc = await PDFDocument.load(pdf)
  // 2 SKUs × 2 template pages + 1 pack overview = 5
  expect(doc.getPageCount()).toBe(5)
})

test('buildCmfPacketPdf stays portrait for every page even with many SKUs', async () => {
  const renders = Array.from({ length: 3 }).map((_, i) => ({
    ...SINGLE_RENDER,
    id: `00000000-0000-0000-0000-00000000000${i + 1}`,
    label: `Switch 2 #${i + 1}`,
    colorwayName: `Way ${i + 1}`,
  }))
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Trio',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: renders as any,
  })
  const doc = await PDFDocument.load(pdf)
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { width, height } = doc.getPage(i).getSize()
    expect(height).toBeGreaterThan(width)
  }
})

/* ── Clown reference page (Damien's follow-up ask) ──────────────────── */

// A minimal valid 1×1 PNG so the PDF builder can embed something without
// touching the network. The bytes below are the standard png magic + a
// single transparent pixel, base64-encoded for legibility.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

test('buildCmfPacketPdf inserts a Clown reference page when a clown is provided', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Emerald',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: [
      {
        ...SINGLE_RENDER,
        clown: {
          imageUrl: TINY_PNG_DATA_URL,
          label: 'Switch 2 default clown',
          components: [
            { region: 'pom_ring', label: 'POM ring', colorHex: '#ff3344' },
            { region: 'cosmetic_cap', label: 'Cosmetic cap', colorHex: '#3366ff' },
          ],
        },
      } as any,
    ],
  })
  const doc = await PDFDocument.load(pdf)
  // CMF spec + Clown reference + Part breakdown = 3 pages.
  expect(doc.getPageCount()).toBe(3)
})

test('buildCmfPacketPdf omits the Clown reference page when no clown is provided', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Emerald',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: [SINGLE_RENDER as any],
  })
  const doc = await PDFDocument.load(pdf)
  // No clown ⇒ still just the 2 base pages.
  expect(doc.getPageCount()).toBe(2)
})

test('buildCmfPacketPdf supports per-SKU clown opt-in for multi-SKU packets', async () => {
  const pdf = await buildCmfPacketPdf({
    packetName: 'Switch 2 Spring 2026',
    cmfCode: 'CMF-001234revA',
    notes: null,
    renders: [
      {
        ...SINGLE_RENDER,
        clown: {
          imageUrl: TINY_PNG_DATA_URL,
          label: 'Switch 2 default clown',
          components: [
            { region: 'pom_ring', label: 'POM ring', colorHex: '#ff3344' },
          ],
        },
      },
      {
        ...SINGLE_RENDER,
        id: '00000000-0000-0000-0000-000000000002',
        label: 'Switch 2 Gold',
        colorwayName: 'Gold',
        // No clown registered for this SKU — the deck should still build.
      },
    ] as any,
  })
  const doc = await PDFDocument.load(pdf)
  // SKU 1: spec + clown + breakdown = 3
  // SKU 2: spec + breakdown = 2 (no clown)
  // Pack overview = 1
  expect(doc.getPageCount()).toBe(6)
})
