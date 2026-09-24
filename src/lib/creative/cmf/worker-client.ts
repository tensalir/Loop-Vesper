/**
 * The creative worker: the plugin repository's own Python (the CMF spec check, the packaging
 * mockup and surface pass) served to Vesper behind a signed API (`docs/worker.md` there). It holds
 * no model key; Vesper holds the keys and signs every request.
 *
 *   X-Creative-Timestamp: <unix seconds>
 *   X-Creative-Signature: sha256=<hex HMAC-SHA256(CREATIVE_WORKER_SECRET, timestamp + "." + raw body)>
 *
 * Env: CREATIVE_WORKER_URL, CREATIVE_WORKER_SECRET.
 */

import crypto from 'crypto'

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = 'WorkerError'
  }
}

export interface WorkerConfig {
  url: string
  secret: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerConfig | null {
  const url = env.CREATIVE_WORKER_URL?.trim()
  const secret = env.CREATIVE_WORKER_SECRET?.trim()
  if (!url || !secret) return null
  return { url: url.replace(/\/+$/, ''), secret }
}

export function signWorkerRequest(secret: string, timestamp: number | string, rawBody: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`
}

/** A signed POST to the worker; its JSON answer, or a WorkerError with the worker's own message. */
export async function callWorker<T = unknown>(cfg: WorkerConfig, route: string, payload: unknown): Promise<T> {
  const fetchImpl = cfg.fetchImpl ?? fetch
  const now = cfg.now ?? Date.now
  const body = JSON.stringify(payload)
  const ts = Math.floor(now() / 1000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 120_000)
  let res: Response
  try {
    res = await fetchImpl(`${cfg.url}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Creative-Timestamp': String(ts),
        'X-Creative-Signature': signWorkerRequest(cfg.secret, ts, body),
      },
      body,
      signal: controller.signal,
    })
  } catch (err) {
    throw new WorkerError(`the creative worker could not be reached (${(err as Error).message})`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: string } | null)?.message ?? (json as { error?: string } | null)?.error ?? text.slice(0, 300)
    throw new WorkerError(`the creative worker refused ${route} (${res.status}): ${msg}`, res.status)
  }
  return json as T
}
