/**
 * Frontify OAuth helpers: endpoints, state handling, and cookie names.
 */

import crypto from 'crypto'
interface CookieReader {
  get(name: string): { value: string } | undefined
}

export const FRONTIFY_ACCESS_COOKIE = 'frontify_access_token'
export const FRONTIFY_REFRESH_COOKIE = 'frontify_refresh_token'
export const FRONTIFY_EXPIRES_COOKIE = 'frontify_expires_at'
export const FRONTIFY_STATE_COOKIE = 'frontify_oauth_state'
export const FRONTIFY_RETURN_TO_COOKIE = 'frontify_oauth_return_to'

function normalizeDomain(domain: string): string {
  if (domain.startsWith('http://') || domain.startsWith('https://')) return domain.replace(/\/+$/, '')
  return `https://${domain.replace(/\/+$/, '')}`
}

export function getFrontifyBaseUrl(): string {
  const domain = process.env.FRONTIFY_DOMAIN
  if (!domain) throw new Error('FRONTIFY_DOMAIN is not set')
  return normalizeDomain(domain)
}

export function getFrontifyAuthorizeUrl(): string {
  return `${getFrontifyBaseUrl()}/api/oauth/authorize`
}

export function getFrontifyTokenUrl(): string {
  return `${getFrontifyBaseUrl()}/api/oauth/accesstoken`
}

export function getFrontifyScopes(): string {
  return (process.env.FRONTIFY_SCOPES ?? 'basic:read').trim()
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString('hex')
}

export function getFrontifyRedirectUri(origin: string): string {
  // Optional override for non-standard deployments.
  return process.env.FRONTIFY_REDIRECT_URI?.trim() || `${origin}/api/auth/frontify/callback`
}

export function getFrontifyAccessTokenFromCookies(cookieStore: CookieReader): string | null {
  return cookieStore.get(FRONTIFY_ACCESS_COOKIE)?.value ?? null
}

