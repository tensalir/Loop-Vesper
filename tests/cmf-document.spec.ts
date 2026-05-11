import { test, expect } from '@playwright/test'
import {
  isDocumentReadyForExport,
  resolveCmfDocument,
  summarisePacketReadiness,
  type PacketForDocument,
} from '../src/lib/cmf/document'

/**
 * Unit tests for the resolved CMF document model — the bridge between
 * approved attempts, the HTML preview, and the PDF generator.
 *
 * Tests pin three behaviours:
 *   - An approved attempt becomes the canonical image for its SKU.
 *   - A draft attempt taints the document as DRAFT.
 *   - Readiness is summarised correctly so the workspace can gate export.
 */

const RENDER_ID = '00000000-0000-0000-0000-00000000000a'
const APPROVED_ATTEMPT_ID = '00000000-0000-0000-0000-0000000000a1'
const DRAFT_ATTEMPT_ID = '00000000-0000-0000-0000-0000000000a2'

function buildPacket(opts: {
  approved?: boolean
  hasDraftAttempt?: boolean
  missing?: boolean
  draft?: any
}): PacketForDocument {
  const attempts: any[] = []
  if (opts.approved) {
    attempts.push({
      id: APPROVED_ATTEMPT_ID,
      renderId: RENDER_ID,
      attemptNumber: 1,
      status: 'ready',
      approvalStatus: 'approved',
      imageUrl: 'https://cdn/approved.png',
      imageWidth: 1024,
      imageHeight: 1024,
      completedAt: new Date('2026-05-10T10:00:00Z'),
    })
  }
  if (opts.hasDraftAttempt) {
    attempts.push({
      id: DRAFT_ATTEMPT_ID,
      renderId: RENDER_ID,
      attemptNumber: 2,
      status: 'ready',
      approvalStatus: 'pending',
      imageUrl: 'https://cdn/draft.png',
      imageWidth: 1024,
      imageHeight: 1024,
      completedAt: new Date('2026-05-10T11:00:00Z'),
    })
  }

  return {
    id: '00000000-0000-0000-0000-00000000000b',
    name: 'Switch 2 Sage',
    cmfCode: 'CMF-001234revA',
    notes: null,
    generatedAt: new Date('2026-05-10T12:00:00Z'),
    documentDraft: opts.draft ?? null,
    renders: opts.missing
      ? []
      : ([
          {
            id: RENDER_ID,
            packetId: '00000000-0000-0000-0000-00000000000b',
            label: 'Switch 2 Sage',
            colorwayName: 'Sage',
            productSlug: 'switch2',
            variantSlug: 'default',
            productCode: 'SW2-SAGE-001',
            ean: null,
            componentSpecs: [
              { region: 'pom_ring', label: 'POM ring', pantone: 'PANTONE 7720C', material: 'POM', finish: 'Matte' },
            ],
            paletteSwatches: [],
            renderUrl: opts.approved ? 'https://cdn/approved.png' : null,
            renderPath: null,
            renderWidth: 1024,
            renderHeight: 1024,
            selectedAttemptId: opts.approved ? APPROVED_ATTEMPT_ID : null,
            status: 'ready',
            error: null,
            costUsd: null,
            attempts: attempts.length,
            sortOrder: 0,
            clownAssetId: null,
            modelId: null,
            basePrompt: null,
            enhancedPrompt: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ownerId: '00000000-0000-0000-0000-00000000000c',
            renderAttempts: attempts,
          } as any,
        ] as any),
  }
}

test('resolveCmfDocument selects the approved attempt as the canonical image', () => {
  const packet = buildPacket({ approved: true })
  const doc = resolveCmfDocument(packet)
  expect(doc.pages).toHaveLength(1)
  expect(doc.pages[0].imageUrl).toBe('https://cdn/approved.png')
  expect(doc.pages[0].isDraft).toBe(false)
  expect(doc.isDraft).toBe(false)
  expect(isDocumentReadyForExport(doc)).toBe(true)
})

test('resolveCmfDocument flags pages as draft when only a pending attempt exists', () => {
  const packet = buildPacket({ hasDraftAttempt: true })
  const doc = resolveCmfDocument(packet)
  expect(doc.pages).toHaveLength(1)
  expect(doc.pages[0].imageUrl).toBe('https://cdn/draft.png')
  expect(doc.pages[0].isDraft).toBe(true)
  expect(doc.isDraft).toBe(true)
  expect(isDocumentReadyForExport(doc)).toBe(false)
})

test('resolveCmfDocument honours documentDraft labels and ordering', () => {
  const packet = buildPacket({
    approved: true,
    draft: {
      packetName: 'Brand-new packet name',
      cmfCode: 'CMF-999999revZ',
      skuOverrides: [
        {
          renderId: RENDER_ID,
          colorwayLabel: 'Override label',
        },
      ],
    },
  })
  const doc = resolveCmfDocument(packet)
  expect(doc.packetName).toBe('Brand-new packet name')
  expect(doc.cmfCode).toBe('CMF-999999revZ')
  expect(doc.pages[0].colorwayLabel).toBe('Override label')
})

test('summarisePacketReadiness counts approved / draft / missing buckets', () => {
  const approved = buildPacket({ approved: true })
  expect(summarisePacketReadiness(approved)).toEqual({
    total: 1,
    approved: 1,
    draftOnly: 0,
    missing: 0,
  })

  const draft = buildPacket({ hasDraftAttempt: true })
  expect(summarisePacketReadiness(draft)).toEqual({
    total: 1,
    approved: 0,
    draftOnly: 1,
    missing: 0,
  })

  const none = buildPacket({})
  expect(summarisePacketReadiness(none)).toEqual({
    total: 1,
    approved: 0,
    draftOnly: 0,
    missing: 1,
  })
})

test('draft override with imageSource=draft surfaces the chosen attempt', () => {
  const packet = buildPacket({
    approved: true,
    hasDraftAttempt: true,
    draft: {
      skuOverrides: [
        {
          renderId: RENDER_ID,
          imageSource: 'draft',
          draftAttemptId: DRAFT_ATTEMPT_ID,
        },
      ],
    },
  })
  const doc = resolveCmfDocument(packet)
  expect(doc.pages[0].imageUrl).toBe('https://cdn/draft.png')
  expect(doc.pages[0].isDraft).toBe(true)
  expect(isDocumentReadyForExport(doc)).toBe(false)
})
