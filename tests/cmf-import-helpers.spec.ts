/**
 * Pins two pure helpers of the packets made the old way (src/lib/cmf/service.ts):
 *
 *   - `LIST_PACKETS_ORDER_BY` — the orderBy clause backing the packet
 *     list, which the CMF Studio's History tab still reads. Pinning it
 *     means a reshuffle of `listAccessiblePackets` can't quietly drop
 *     the "most-recently-touched at the top" contract (Damien's "I see
 *     edited 6 days ago" failure mode).
 *
 *   - `shouldRunSignatureMerge` — the predicate that gated the old
 *     importer's signature-fallback merge (off by default, only when
 *     "Replace existing packet" was ticked AND there's no cmfCode).
 *
 * The import dialog's error helpers went with the dialog: a workbook is
 * now uploaded through /api/cmf/v2/uploads, and a refusal is shown in
 * the CMF service's own words.
 */

import { test, expect } from '@playwright/test'
import {
  LIST_PACKETS_ORDER_BY,
  shouldRunSignatureMerge,
} from '../src/lib/cmf/service'

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
