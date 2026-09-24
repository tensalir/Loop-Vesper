/**
 * OAuth 2.1 for the Vesper MCP connector: the settings and the fixed numbers.
 *
 * Each person connects Claude to Vesper with their own Vesper sign-in. The
 * authorization server and the protected resource are the same app: the issuer
 * is the site's origin, the resource is `<origin>/api/mcp`.
 *
 * Environment:
 *   MCP_OAUTH_SECRET               signs client ids, client secrets and pending
 *                                  authorization requests; at least 32 characters.
 *                                  Without it the sign-in is off.
 *   MCP_OAUTH_ENABLED              `0` turns the sign-in off (register, authorize and
 *                                  token answer 503); static vsp_live_ tokens keep working.
 *   MCP_OAUTH_REDIRECT_ALLOWLIST   extra redirect URIs, comma-separated, exact match.
 *   MCP_OAUTH_CIMD                 `1` accepts client ids that are https URLs of a
 *                                  client metadata document...
 *   MCP_OAUTH_CIMD_HOSTS           ...on these hosts, comma-separated.
 *   MCP_RESOURCE_ALIASES           other resource URLs this server answers to, comma-
 *                                  separated (a second domain in front of the same app).
 */

export const OAUTH_SCOPE = 'mcp:tools'
export const SCOPES_SUPPORTED = ['mcp:tools', 'offline_access'] as const

export const ACCESS_TOKEN_PREFIX = 'vsp_oat_'
export const REFRESH_TOKEN_PREFIX = 'vsp_ort_'
export const CLIENT_ID_PREFIX = 'vmc_'

export const CODE_TTL_SECONDS = 5 * 60
export const AUTH_REQUEST_TTL_SECONDS = 10 * 60
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_SLIDING_SECONDS = 30 * 24 * 60 * 60
export const REFRESH_ABSOLUTE_SECONDS = 180 * 24 * 60 * 60
/** A spent refresh token presented again within this window gets a sibling pair (a retry, or two tabs refreshing at once). */
export const REFRESH_GRACE_SECONDS = 60

export const CLIENT_NAME_MAX = 80
export const MAX_REDIRECT_URIS = 10

/** The rate limits of an OAuth credential. */
export const OAUTH_RATE_LIMIT_PER_MINUTE = 60
export const OAUTH_RATE_LIMIT_PER_DAY = 3000

export interface OAuthConfig {
  enabled: boolean
  secret: string | null
  cimd: boolean
  cimdHosts: string[]
  redirectAllowlist: string[]
  resourceAliases: string[]
}

function list(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function oauthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const raw = (env.MCP_OAUTH_SECRET || '').trim()
  const secret = raw.length >= 32 ? raw : null
  return {
    enabled: env.MCP_OAUTH_ENABLED !== '0' && secret !== null,
    secret,
    cimd: env.MCP_OAUTH_CIMD === '1',
    cimdHosts: list(env.MCP_OAUTH_CIMD_HOSTS).map((h) => h.toLowerCase()),
    redirectAllowlist: list(env.MCP_OAUTH_REDIRECT_ALLOWLIST),
    resourceAliases: list(env.MCP_RESOURCE_ALIASES).map((r) => r.replace(/\/$/, '')),
  }
}
