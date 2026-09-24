/**
 * Where an authorization code may be sent.
 *
 * Only Claude's own callbacks, a loopback address on any port (Claude Code, the
 * MCP Inspector and other desktop clients listen there), and whatever the
 * owner adds to `MCP_OAUTH_REDIRECT_ALLOWLIST`, compared exactly. A redirect
 * with a fragment is refused (RFC 6749 §3.1.2). Registration and authorize both
 * check here, so a client registered before a rule tightened is refused at the
 * next sign-in.
 */

export const CLAUDE_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
] as const

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOOPBACK_PATHS = new Set(['/callback', '/oauth/callback', '/oauth/callback/debug'])

function parse(uri: string): URL | null {
  if (typeof uri !== 'string' || uri.length > 2000 || uri.includes('#')) return null
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

export function isLoopbackRedirect(uri: string): boolean {
  const url = parse(uri)
  if (!url || url.protocol !== 'http:' || url.username || url.password) return false
  return LOOPBACK_HOSTS.has(url.hostname) && LOOPBACK_PATHS.has(url.pathname)
}

export function isAllowedRedirectUri(uri: string, extra: readonly string[] = []): boolean {
  const url = parse(uri)
  if (!url) return false
  if ((CLAUDE_CALLBACKS as readonly string[]).includes(uri)) return true
  if (isLoopbackRedirect(uri)) return true
  return extra.includes(uri)
}

/**
 * The client a redirect belongs to, as a person would name it: one credential is
 * kept per person and per key, so reconnecting Claude replaces the old grant
 * instead of piling up rows.
 */
export function clientKeyFor(uri: string): string {
  const url = parse(uri)
  if (!url) return 'unknown'
  if (url.hostname === 'claude.ai') return 'claude.ai'
  if (url.hostname === 'claude.com') return 'claude.com'
  if (LOOPBACK_HOSTS.has(url.hostname)) return 'loopback'
  return url.host
}

/** The host shown to the person on the consent page as who is asking. */
export function redirectHostLabel(uri: string): string {
  const url = parse(uri)
  if (!url) return 'an unknown app'
  if (LOOPBACK_HOSTS.has(url.hostname)) return 'an app on this computer (Claude Code or a desktop client)'
  return url.host
}
