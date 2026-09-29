/**
 * A small GitHub REST client over the App's installation token.
 *
 * - `X-GitHub-Api-Version` on every call;
 * - an `etag` in, `If-None-Match` out: a 304 costs nothing against the rate limit;
 * - 5xx and secondary rate limits are retried with a short backoff; a 401
 *   drops the cached token once and tries again;
 * - the remaining rate limit is logged when it runs low.
 */

import { GITHUB_API, GITHUB_API_VERSION, type InstallationTokenCache } from './app'

export interface GhRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** e.g. 'application/vnd.github.raw' for file bytes. */
  accept?: string
  etag?: string | null
}

export interface GhResponse {
  status: number
  etag: string | null
  /** The body as bytes; `json()` parses it. */
  bytes: Buffer
  json<T = unknown>(): T
}

export interface GhClientDeps {
  tokens: Pick<InstallationTokenCache, 'getToken' | 'invalidate'>
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
}

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GithubError'
  }
}

export type Gh = (path: string, req?: GhRequest) => Promise<GhResponse>

export function githubClient(deps: GhClientDeps): Gh {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const maxAttempts = deps.maxAttempts ?? 4

  return async function gh(path: string, req: GhRequest = {}): Promise<GhResponse> {
    let retriedAuth = false
    let last = 'no attempt made'
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const token = await deps.tokens.getToken()
      const headers: Record<string, string> = {
        Accept: req.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'vesper-creative-kit',
      }
      if (req.etag) headers['If-None-Match'] = req.etag
      if (req.body !== undefined) headers['Content-Type'] = 'application/json'
      const url = path.startsWith('https://') ? path : `${GITHUB_API}${path}`
      let res: Response
      try {
        res = await fetchImpl(url, {
          method: req.method ?? 'GET',
          headers,
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
        })
      } catch (err) {
        last = (err as Error)?.message || 'network error'
        await sleep(500 * attempt)
        continue
      }
      const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? NaN)
      if (Number.isFinite(remaining) && remaining < 100) {
        console.warn(`[github] ${remaining} requests left before the rate limit resets`)
      }
      if (res.status === 401 && !retriedAuth) {
        retriedAuth = true
        deps.tokens.invalidate()
        continue
      }
      const secondary = res.status === 403 && /secondary rate limit/i.test(await peek(res))
      if (res.status >= 500 || res.status === 429 || secondary) {
        last = `HTTP ${res.status}`
        const retryAfter = Number(res.headers.get('retry-after') ?? 0)
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * attempt)
        continue
      }
      const bytes = Buffer.from(await res.arrayBuffer())
      const out: GhResponse = {
        status: res.status,
        etag: res.headers.get('etag'),
        bytes,
        json<T>() {
          return JSON.parse(bytes.toString('utf8')) as T
        },
      }
      if (res.status >= 400 && res.status !== 404) {
        throw new GithubError(`GitHub ${req.method ?? 'GET'} ${path} answered ${res.status}: ${bytes.toString('utf8').slice(0, 200)}`, res.status)
      }
      return out
    }
    throw new GithubError(`GitHub ${req.method ?? 'GET'} ${path} failed after ${maxAttempts} attempts (${last})`, 0)
  }
}

/** Read a 403's body for the secondary-limit wording without consuming the caller's copy. */
async function peek(res: Response): Promise<string> {
  try {
    return await res.clone().text()
  } catch {
    return ''
  }
}
