/**
 * Where to go after signing in: a path on this site only.
 *
 * The sign-in for Claude starts at `/connect?areq=…`; if the person is not
 * signed in to Vesper, the login page must bring them back there. `next`
 * comes from a URL, so anything that could leave the site is refused: a
 * scheme, `//host`, `/\host`, a backslash anywhere, control characters.
 */

export const NEXT_COOKIE = 'vesper_next'
export const DEFAULT_NEXT = '/projects'

export function safeNext(value: string | null | undefined, fallback: string = DEFAULT_NEXT): string {
  if (!value || typeof value !== 'string' || value.length > 4000) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const base = 'https://vesper.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
