/**
 * Promise-shape helpers for CMF route handlers.
 *
 * `withTimeout` wraps an inner promise so a slow / hanging downstream
 * call (Supabase Storage, an external API) can't hold the entire
 * request hostage. The wrapped promise rejects with the supplied
 * message once the timeout fires; the inner promise keeps running but
 * its outcome is discarded.
 *
 * Why this lives next to the CMF code rather than as a generic util:
 *   - The import route was hanging the import button because the
 *     workbook storage upload was awaited without a bound, and the
 *     team needed a narrowly-scoped fix rather than a global retry
 *     policy.
 *   - Keeping the helper here makes the timeout policy a CMF
 *     concern that future routes (clown upload, refinement-reference
 *     upload, PDF export) can adopt one at a time, each with their
 *     own appropriate bound.
 */

export class CmfTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CmfTimeoutError'
  }
}

/**
 * Race `promise` against a timer. Resolves with the inner value when
 * the inner promise wins, rejects with `CmfTimeoutError(reason)` when
 * the timer wins. The inner promise is not cancelled — callers that
 * need cancellation should pass an `AbortSignal` to whatever they
 * await. The timer is always cleared so the host process can exit
 * cleanly when the inner promise resolves first.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  reason: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CmfTimeoutError(reason))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
