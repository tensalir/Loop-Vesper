/**
 * Pins the cache-invalidation contract for `useImportCmfWorkbook`.
 *
 * The bug this guards: a designer re-uploaded a workbook with a new
 * SKU, the import succeeded, but the open packet's gallery kept
 * showing the old SKU set until they manually navigated away and
 * back. Root cause: the mutation only invalidated the packet LIST
 * query, not the per-packet DETAIL query the workspace was
 * subscribed to.
 *
 * Rather than spin up a QueryClient and a fake fetch layer, the hook
 * exports a pure `cmfImportInvalidationKeys(data)` helper that names
 * every key the `onSuccess` handler should invalidate. These tests
 * exercise that helper against the response shapes the import route
 * actually returns: single-product imports, multi-product imports,
 * and the no-packet validation-only case.
 */

import { test, expect } from '@playwright/test'
import { cmfImportInvalidationKeys } from '../src/hooks/useCmf'
import type { CmfImportResponse, CmfPacket } from '../src/hooks/useCmf'

// Minimal CmfPacket stub — only `id` is read by the helper, but the
// full type is enforced at the call site so we don't drift from the
// canonical shape.
function stubPacket(id: string): CmfPacket {
  return {
    id,
    name: `Packet ${id}`,
    cmfCode: null,
    notes: null,
    status: 'draft',
    pdfUrl: null,
    pdfPath: null,
    pdfError: null,
    generatedAt: null,
    documentDraft: null,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    renders: [],
  }
}

test('always invalidates the packet list', () => {
  const keys = cmfImportInvalidationKeys({})
  expect(keys).toContainEqual(['cmf', 'packets'])
})

test('invalidates the auto-open primary packet detail query', () => {
  const data: Pick<CmfImportResponse, 'packet' | 'packets'> = {
    packet: stubPacket('packet-primary'),
  }
  const keys = cmfImportInvalidationKeys(data)
  expect(keys).toContainEqual(['cmf', 'packets'])
  expect(keys).toContainEqual(['cmf', 'packet', 'packet-primary'])
})

test('invalidates every packet detail in a multi-product import', () => {
  // Switch 2 + Cocoon shape — the route returns one entry per
  // product slug under `packets`. The active workspace might be on
  // EITHER one, so the gallery for both has to refresh in lockstep.
  const data: Pick<CmfImportResponse, 'packet' | 'packets'> = {
    packet: stubPacket('packet-switch2'),
    packets: [
      {
        id: 'packet-switch2',
        name: 'Switch 2 Spring 2026',
        cmfCode: 'CMF-001234revA',
        status: 'draft',
        productSlug: 'switch2',
        productName: 'Loop Switch 2',
        renderCount: 3,
      },
      {
        id: 'packet-cocoon',
        name: 'Cocoon Spring 2026',
        cmfCode: 'CMF-002000revA',
        status: 'draft',
        productSlug: 'cocoon',
        productName: 'Loop Cocoon',
        renderCount: 1,
      },
    ],
  }
  const keys = cmfImportInvalidationKeys(data)
  expect(keys).toContainEqual(['cmf', 'packets'])
  expect(keys).toContainEqual(['cmf', 'packet', 'packet-switch2'])
  expect(keys).toContainEqual(['cmf', 'packet', 'packet-cocoon'])
})

test('does not invalidate the same packet detail twice when it appears in both data.packet and data.packets', () => {
  // The route returns the primary packet on both `data.packet` and
  // inside `data.packets`. The naive implementation queued two
  // invalidations for it; the de-duplicating helper should only
  // emit one. We assert this by counting matches rather than by
  // raw length so future additions (e.g. a separate `clowns` key)
  // don't break the test.
  const data: Pick<CmfImportResponse, 'packet' | 'packets'> = {
    packet: stubPacket('packet-switch2'),
    packets: [
      {
        id: 'packet-switch2',
        name: 'Switch 2 Spring 2026',
        cmfCode: null,
        status: 'draft',
        productSlug: 'switch2',
        productName: 'Loop Switch 2',
        renderCount: 3,
      },
    ],
  }
  const keys = cmfImportInvalidationKeys(data)
  const matches = keys.filter(
    (k) => k[0] === 'cmf' && k[1] === 'packet' && k[2] === 'packet-switch2'
  )
  expect(matches).toHaveLength(1)
})

test('handles the validation-only response (no packets created) without crashing', () => {
  // The route returns just `{ import: { ... } }` when `createPacket`
  // is false or the workbook produced 0 rows. The helper should
  // still emit the packet-list invalidation so the dialog can
  // refresh — and must not throw when `packet` / `packets` are
  // absent.
  const keys = cmfImportInvalidationKeys({})
  expect(keys).toEqual([['cmf', 'packets']])
})

test('skips packets entries with no id (defensive)', () => {
  // Defensive: a future server-side change shouldn't poison the
  // query cache with `['cmf','packet', undefined]` invalidations.
  const data: Pick<CmfImportResponse, 'packet' | 'packets'> = {
    packets: [
      // @ts-expect-error — testing the defensive branch with a
      // deliberately malformed entry the server should never emit.
      { id: '', name: 'Empty', cmfCode: null, status: 'draft', productSlug: null, productName: null, renderCount: 0 },
    ],
  }
  const keys = cmfImportInvalidationKeys(data)
  expect(keys).toEqual([['cmf', 'packets']])
})
