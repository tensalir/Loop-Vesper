/**
 * Tests for the unified placeholder policy.
 *
 * Both `xlsx.ts:isReal` and `schema.ts:cleanField` now consume
 * `isPlaceholderValue` from `lib/cmf/placeholder.ts`, so a value can no
 * longer be "real" in the parser but stripped in the normaliser (or
 * vice versa). These tests pin the rules in one place.
 */

import { test, expect } from '@playwright/test'
import { isPlaceholderValue, isRealValue } from '../src/lib/cmf/placeholder'

test('rejects pure x-runs of any length', () => {
  expect(isPlaceholderValue('xxxxxxxxxxx')).toBe(true)
  expect(isPlaceholderValue('XX')).toBe(true)
  // Even a single 'x' matches the pure-x-run rule. Empirically all the
  // workbook placeholders we've seen are at least two x's, but the
  // rule errs on the strict side because no real spec value is
  // literally just "x".
  expect(isPlaceholderValue('x')).toBe(true)
})

test('rejects date placeholders with x-segments', () => {
  expect(isPlaceholderValue('xx/xx/xxxx')).toBe(true)
  expect(isPlaceholderValue('xxxx/xx/xx')).toBe(true)
  // A real date should NOT be flagged.
  expect(isPlaceholderValue('2026-05-13')).toBe(false)
  expect(isPlaceholderValue('13/05/2026')).toBe(false)
})

test('rejects CMF-revision placeholders', () => {
  expect(isPlaceholderValue('CMF-xxxxxx rev x')).toBe(true)
  expect(isPlaceholderValue('cmf-xxx rev x')).toBe(true)
  // Real CMF codes should pass.
  expect(isPlaceholderValue('CMF-001234revA')).toBe(false)
  expect(isPlaceholderValue('CMF-001234 rev A')).toBe(false)
})

test('rejects Pantone placeholders', () => {
  expect(isPlaceholderValue('Pantone xxxxxxxxxxx')).toBe(true)
  expect(isPlaceholderValue('pantone xxxx')).toBe(true)
  // Real Pantone codes should pass even when they contain 'x'-adjacent text.
  expect(isPlaceholderValue('PANTONE 17-5641 TCX')).toBe(false)
  expect(isPlaceholderValue('Pantone 7720C')).toBe(false)
  expect(isPlaceholderValue('Pantone Black 6C')).toBe(false)
})

test('rejects single-character separator placeholders', () => {
  expect(isPlaceholderValue('/')).toBe(true)
  expect(isPlaceholderValue('-')).toBe(true)
  // Multi-character separators or text containing one are not flagged.
  expect(isPlaceholderValue('--')).toBe(false)
  expect(isPlaceholderValue('A/B')).toBe(false)
})

test('rejects long generic x-dominated strings', () => {
  // 6+ CONSECUTIVE x's with only x's left after stripping → placeholder.
  expect(isPlaceholderValue('xxxxxx')).toBe(true)
  // The generic-x rule requires a contiguous run of 6 x's. Strings with
  // shorter runs separated by punctuation (`xx-xx-xx`) don't trip the
  // generic rule even though they "look" placeholder-y. The pure-x-run
  // rule (which would catch them) is anchored to the whole string with
  // `^x+$`, so dashes break it. This is intentional: workbook drafts
  // we've seen use `xxxxxxxxxxx` not `xx-xx-xx`.
  expect(isPlaceholderValue('xx-xx-xx')).toBe(false)
  // Real text containing x but with letters around it should pass.
  expect(isPlaceholderValue('Maxxxxx 9')).toBe(false)
  expect(isPlaceholderValue('exxon')).toBe(false)
})

test('isRealValue is the symmetric counterpart for non-empty input', () => {
  const placeholders = ['xxxxxxxxxxx', 'xx/xx/xxxx', 'CMF-xxxxx rev x', '/']
  const real = ['Switch 2 Sage', 'PANTONE 17-5641 TCX', 'CMF-001234revA']
  for (const v of placeholders) {
    expect(isRealValue(v)).toBe(false)
    expect(isPlaceholderValue(v)).toBe(true)
  }
  for (const v of real) {
    expect(isRealValue(v)).toBe(true)
    expect(isPlaceholderValue(v)).toBe(false)
  }
})

test('null / empty / whitespace are treated as absences, not placeholders', () => {
  // Both predicates must return false for missing input — neither
  // "real" nor "placeholder", but absent.
  for (const v of [null, undefined, '', '   ']) {
    expect(isRealValue(v)).toBe(false)
    expect(isPlaceholderValue(v)).toBe(false)
  }
})
