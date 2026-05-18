/**
 * Pins three pure helpers that gate the import-dialog UX surface:
 *
 *   - `deriveImportErrorMessage` — maps whatever the mutation rejects
 *     with into a single human-readable string for the persistent
 *     error panel. Three input shapes appear in practice (`Error`,
 *     `string`, anything else); all three must produce a useful
 *     sentence so the panel never shows `[object Object]`.
 *
 *   - `LIST_PACKETS_ORDER_BY` — the orderBy clause backing the
 *     cross-product packets list. Pinning it here means a future
 *     reshuffle of `listAccessiblePackets` can't quietly drop the
 *     "most-recently-touched at the top" contract the rail depends
 *     on (Damien's "I see edited 6 days ago" failure mode).
 *
 *   - `shouldRunSignatureMerge` — the predicate that gates the
 *     signature-fallback merge. Lives in service.ts so it can be
 *     unit-tested without spinning up Prisma; this test pins the
 *     opt-in contract (off by default, only fires when the user
 *     explicitly ticks "Replace existing packet" AND there's no
 *     cmfCode to anchor on).
 */

import { test, expect } from '@playwright/test'
import { deriveImportErrorMessage } from '../src/hooks/useCmf'
import {
  LIST_PACKETS_ORDER_BY,
  shouldRunSignatureMerge,
} from '../src/lib/cmf/service'

/* ── deriveImportErrorMessage ───────────────────────────────────────────── */

test('deriveImportErrorMessage extracts the message from Error instances', () => {
  expect(deriveImportErrorMessage(new Error('cmf_access_required'))).toBe(
    'cmf_access_required'
  )
})

test('deriveImportErrorMessage passes strings through verbatim', () => {
  expect(deriveImportErrorMessage('Workbook too large (max 10 MB)')).toBe(
    'Workbook too large (max 10 MB)'
  )
})

test('deriveImportErrorMessage falls back when Error.message is empty', () => {
  expect(deriveImportErrorMessage(new Error(''))).toBe('Import failed')
  expect(deriveImportErrorMessage(new Error('   '))).toBe('Import failed')
})

test('deriveImportErrorMessage falls back for null / undefined / plain objects', () => {
  expect(deriveImportErrorMessage(null)).toBe('Import failed')
  expect(deriveImportErrorMessage(undefined)).toBe('Import failed')
  expect(deriveImportErrorMessage({ error: 'wat' })).toBe('Import failed')
})

/* ── LIST_PACKETS_ORDER_BY ──────────────────────────────────────────────── */

test('packet list orderBy sorts by updatedAt desc so just-touched packets surface first', () => {
  // The rail in the Products dialog and the workspace dropdown
  // both read this query. If a future refactor flips back to
  // createdAt, merged packets would drop back to their original
  // position — Damien's exact pre-fix symptom. Pin the contract.
  expect(LIST_PACKETS_ORDER_BY).toEqual({ updatedAt: 'desc' })
})

/* ── shouldRunSignatureMerge ────────────────────────────────────────────── */

test('signature merge is off when replaceExisting is false (default)', () => {
  // The whole point of the gate: an iterative upload without a
  // cmfCode should NOT silently merge into a same-SKU-set older
  // packet. The default must be no-merge so future regressions
  // can't reintroduce the sprawl behaviour silently.
  expect(
    shouldRunSignatureMerge({ replaceExisting: false, inferredCmf: null })
  ).toBe(false)
  expect(
    shouldRunSignatureMerge({ replaceExisting: false, inferredCmf: 'CMF-001revA' })
  ).toBe(false)
})

test('signature merge runs only when explicitly opted in AND there is no cmfCode', () => {
  // Opt-in flag honoured for the cmfCode-less case (the typical
  // template-with-placeholders workbook Damien iterates on).
  expect(
    shouldRunSignatureMerge({ replaceExisting: true, inferredCmf: null })
  ).toBe(true)
})

test('signature merge stays off when a cmfCode is present even with opt-in', () => {
  // With a real cmfCode the exact-match path handles the merge.
  // The signature fallback is a fallback specifically for the
  // no-cmfCode case — re-running it would risk merging into a
  // packet with a different cmfCode that happens to share the
  // SKU set, which is the wrong behaviour.
  expect(
    shouldRunSignatureMerge({ replaceExisting: true, inferredCmf: 'CMF-001revA' })
  ).toBe(false)
})
