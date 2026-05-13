/**
 * Tests for the unified CMF error envelope.
 *
 * Pinning the response shape here means a future route refactor that
 * accidentally drops `details` / `category` / extra fields back into
 * one-off shapes will fail loudly instead of breaking the client
 * silently. The client (`useCmf.ts`) currently reads `error.error`
 * exclusively but routes intentionally include `details` (validation),
 * `category` (domain-specific failures), and `extra` (PDF readiness,
 * partial uploads) so these tests guard the contract.
 */

import { test, expect } from '@playwright/test'
import { cmfError, translateAccessError } from '../src/lib/cmf/api'
import { CmfForbiddenError, CmfNotFoundError } from '../src/lib/cmf/service'

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  return JSON.parse(text)
}

test('cmfError defaults to 400 with just an error key', async () => {
  const res = cmfError('something is wrong')
  expect(res.status).toBe(400)
  const body = await bodyOf(res)
  expect(body).toEqual({ error: 'something is wrong' })
})

test('cmfError honours custom status codes', async () => {
  const res = cmfError('forbidden', { status: 403 })
  expect(res.status).toBe(403)
  expect((await bodyOf(res)).error).toBe('forbidden')
})

test('cmfError attaches details for validation failures', async () => {
  const res = cmfError('Invalid request body', {
    details: [
      { path: 'rows.0.label', message: 'required' },
      { path: 'rows.0.productSlug', message: 'required' },
    ],
  })
  const body = await bodyOf(res)
  expect(body.error).toBe('Invalid request body')
  expect(body.details).toEqual([
    { path: 'rows.0.label', message: 'required' },
    { path: 'rows.0.productSlug', message: 'required' },
  ])
})

test('cmfError omits empty `details` arrays', async () => {
  // Routes routinely call `parsed.error.issues.map(...)` which can
  // produce an empty array if the schema fails for non-issue
  // reasons. Keep the response clean by dropping empties.
  const res = cmfError('bad', { details: [] })
  const body = await bodyOf(res)
  expect(body).toEqual({ error: 'bad' })
})

test('cmfError surfaces a category for domain-specific failures', async () => {
  const res = cmfError('Reference download failed', {
    status: 422,
    category: 'reference',
  })
  expect(res.status).toBe(422)
  const body = await bodyOf(res)
  expect(body.category).toBe('reference')
})

test('cmfError merges arbitrary `extra` fields into the body', async () => {
  // PDF route uses this for `readiness`; refinement-references for
  // `uploaded`. The shape stays predictable: `error` + `extra` keys
  // alongside, no nesting.
  const res = cmfError('Not ready', {
    status: 422,
    extra: { readiness: { approved: 1, total: 4 } },
  })
  const body = await bodyOf(res)
  expect(body.error).toBe('Not ready')
  expect(body.readiness).toEqual({ approved: 1, total: 4 })
})

test('translateAccessError maps CmfNotFoundError to 404', async () => {
  const res = translateAccessError(new CmfNotFoundError('Packet not found'))
  expect(res).not.toBeNull()
  expect(res!.status).toBe(404)
  const body = await bodyOf(res!)
  expect(body).toEqual({ error: 'Packet not found' })
})

test('translateAccessError maps CmfForbiddenError to 403', async () => {
  const res = translateAccessError(new CmfForbiddenError('Forbidden'))
  expect(res).not.toBeNull()
  expect(res!.status).toBe(403)
})

test('translateAccessError returns null for unknown error types', async () => {
  // Rule of thumb: only OUR domain exceptions get translated. Anything
  // else bubbles up so Next.js produces a 500 (and the stack trace
  // shows up in logs) instead of a misleading 4xx.
  expect(translateAccessError(new Error('bare error'))).toBeNull()
  expect(translateAccessError({ random: 'object' })).toBeNull()
  expect(translateAccessError(null)).toBeNull()
})
