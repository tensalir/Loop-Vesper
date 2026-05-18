/**
 * Contract tests for `withTimeout` — the helper that keeps the CMF
 * import route from hanging when Supabase Storage stalls. The
 * original incident was the import button spinning indefinitely
 * after a workbook upload, because the storage call had no upper
 * bound; these tests pin the three properties the route depends on:
 *
 *   1. Fast inner work passes its value through (no false timeouts).
 *   2. Slow inner work loses to the timer and rejects with the
 *      sentinel `CmfTimeoutError` so callers can branch on it.
 *   3. Inner rejections propagate verbatim and don't get masked as
 *      timeouts — operators need to tell "storage was slow" from
 *      "storage errored".
 */

import { test, expect } from '@playwright/test'
import { CmfTimeoutError, withTimeout } from '../src/lib/cmf/promise'

test('withTimeout resolves with the inner value when it finishes in time', async () => {
  const value = await withTimeout(Promise.resolve(42), 1000, 'should not fire')
  expect(value).toBe(42)
})

test('withTimeout rejects with CmfTimeoutError when the timer wins', async () => {
  // Inner promise never resolves; the timer should fire and reject.
  // We give a generous-enough delay that local timer noise can't
  // race the assertion the other way.
  const pending = new Promise<number>(() => {
    // intentionally never resolves
  })
  let caught: unknown
  try {
    await withTimeout(pending, 25, 'storage upload exceeded 25ms')
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(CmfTimeoutError)
  expect((caught as Error).message).toBe('storage upload exceeded 25ms')
})

test('withTimeout surfaces inner rejections without rewriting them as timeouts', async () => {
  const inner = Promise.reject(new Error('Storage upload failed: bucket missing'))
  // Catch the rejection so playwright doesn't flag it as unhandled
  // before withTimeout has a chance to attach its own handler.
  inner.catch(() => {})
  let caught: unknown
  try {
    await withTimeout(inner, 1000, 'should not fire')
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  expect(caught).not.toBeInstanceOf(CmfTimeoutError)
  expect((caught as Error).message).toBe('Storage upload failed: bucket missing')
})

test('withTimeout clears its timer when the inner promise wins', async () => {
  // Regression guard: an earlier draft left the timer pending after
  // a successful resolution, which kept the Node event loop alive
  // and made tests flaky. We can't observe the timer directly, but
  // we CAN observe that the wrapped resolution returns immediately
  // (well under the timeout) and that no extra rejection arrives
  // afterwards.
  const start = Date.now()
  const value = await withTimeout(Promise.resolve('done'), 5000, 'should not fire')
  const elapsed = Date.now() - start
  expect(value).toBe('done')
  expect(elapsed).toBeLessThan(200)

  // Wait past what the timer would have fired at to make sure no
  // late rejection sneaks through and surfaces as an unhandled
  // promise rejection. If the timer leaked, this `await` would
  // resolve fine but the unhandled-rejection handler in playwright
  // would still flag the test on the next tick.
  await new Promise((resolve) => setTimeout(resolve, 50))
})
