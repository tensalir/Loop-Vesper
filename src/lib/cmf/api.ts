/**
 * Shared HTTP plumbing for CMF route handlers.
 *
 * Two helpers, both small:
 *
 *   - `cmfError` — the canonical error envelope. Every CMF route that
 *     returns a 4xx/5xx should funnel through this so the response
 *     shape stays uniform: `{ error, details?, category?, ...extra }`.
 *     Today routes scatter `{ error }`, `{ error, details }`,
 *     `{ error, category }`, `{ error, readiness }`, and partial-
 *     upload `{ error, uploaded }`. The client (`useCmf.ts`) only
 *     reads `error.error`, so the variants are invisible — but they
 *     make adding response shapes (e.g. `retryAfter`) error-prone.
 *
 *   - `translateAccessError` — converts our internal
 *     `CmfNotFoundError | CmfForbiddenError` exceptions into the
 *     standard envelope. Multiple route files inlined this same
 *     three-line helper; centralising means a future change to the
 *     forbidden status code (or the error message format) hits one
 *     place instead of three.
 *
 * Both helpers return `NextResponse` directly so callers can
 * `return cmfError(...)` from a handler without a wrapper.
 */

import { NextResponse } from 'next/server'
import { CmfForbiddenError, CmfNotFoundError } from './service'

export interface CmfErrorOptions {
  /** HTTP status code. Defaults to 400 — the most common CMF mistake
   *  is "you sent us bad input". 401/403/404/409/413/422/429/500
   *  override per route. */
  status?: number
  /** Validation issues. Routes that parse a Zod body should pass
   *  `parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))`
   *  so the client receives a uniform shape it can render inline. */
  details?: Array<{ path: string; message: string }>
  /** Domain-specific tag. Used today by attempts + render generate to
   *  classify failures (`reference` / `prompt` / `model` / etc.) so
   *  the UI can show a category-specific recovery hint. */
  category?: string
  /** Free-form extension. Use for response-specific structured payload
   *  that doesn't fit the other slots — e.g. PDF route's `readiness`
   *  on a 422, refinement-references' partial `uploaded` on a 500. */
  extra?: Record<string, unknown>
}

export function cmfError(message: string, opts: CmfErrorOptions = {}): NextResponse {
  const { status = 400, details, category, extra } = opts
  // Build the body in a single object so JSON output ordering stays
  // stable across statuses (the client doesn't depend on order, but
  // diffing fixtures across versions is friendlier this way).
  const body: Record<string, unknown> = { error: message }
  if (details && details.length > 0) body.details = details
  if (category) body.category = category
  if (extra) Object.assign(body, extra)
  return NextResponse.json(body, { status })
}

/**
 * Map a `CmfNotFoundError` / `CmfForbiddenError` to a standard error
 * response. Returns `null` for any other error so the caller can
 * `throw` it (Next.js will return a 500). Use as:
 *
 * ```ts
 *   try { ... }
 *   catch (err) {
 *     const translated = translateAccessError(err)
 *     if (translated) return translated
 *     throw err
 *   }
 * ```
 */
export function translateAccessError(err: unknown): NextResponse | null {
  if (err instanceof CmfNotFoundError) {
    return cmfError(err.message, { status: 404 })
  }
  if (err instanceof CmfForbiddenError) {
    return cmfError(err.message, { status: 403 })
  }
  return null
}
