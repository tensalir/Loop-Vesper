/** Response helpers for the OAuth endpoints. */

import { NextResponse } from 'next/server'
import { CORS_HEADERS } from './metadata'

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...CORS_HEADERS, ...extra },
  })
}

export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): NextResponse {
  return oauthJson({ error, error_description: description }, status, extra)
}

export function unavailable(): NextResponse {
  return oauthError('temporarily_unavailable', 'Sign-in is switched off on this server.', 503)
}

export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/** An `application/x-www-form-urlencoded` body (the token and revocation endpoints), or an empty form. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('content-type') || ''
  const text = await request.text().catch(() => '')
  if (text.length > 16_000) return new URLSearchParams()
  if (type.includes('application/json')) {
    // Lenient: some clients post JSON to the token endpoint.
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      const form = new URLSearchParams()
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') form.set(k, v)
      return form
    } catch {
      return new URLSearchParams()
    }
  }
  return new URLSearchParams(text)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/** A small page for a sign-in that must stop here, never a redirect. */
export function htmlPage(status: number, title: string, message: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Vesper</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141414;color:#e8e8e8;font-family:system-ui,sans-serif;padding:16px}main{max-width:440px;border:1px solid #333;border-radius:12px;padding:28px;background:#1b1b1b}h1{font-size:18px;margin:0 0 12px}p{line-height:1.5;color:#b5b5b5;margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
