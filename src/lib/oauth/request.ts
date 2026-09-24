/**
 * The authorize step: check an authorization request, then carry it to the
 * consent page signed, so nothing about it can change between the check and
 * the person's answer.
 *
 * Order matters (RFC 6749 §4.1.2.1): a request whose client or redirect URI
 * cannot be trusted gets an error page and is never redirected, because a
 * redirect would hand an error, or worse a code, to whoever wrote the URL. Only
 * once both are trusted do the other errors go back to the client.
 */

import { AUTH_REQUEST_TTL_SECONDS, OAUTH_SCOPE, SCOPES_SUPPORTED, type OAuthConfig } from './config'
import { resolveClient, type ClientInfo, type MetadataFetcher } from './clients'
import { signPayload, verifyPayload } from './crypto'
import { acceptedResources, issuerFor, resourceUrl } from './metadata'
import { isValidChallenge } from './pkce'
import { isAllowedRedirectUri } from './redirects'

export interface AuthRequest {
  clientId: string
  clientName: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scope: string
  resource: string
  /** Seconds since the epoch after which the request is void. */
  exp: number
}

export type AuthorizeOutcome =
  | { kind: 'page'; status: number; title: string; message: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'consent'; request: AuthRequest; client: ClientInfo }

export function errorRedirect(
  redirectUri: string,
  origin: string,
  error: string,
  description: string,
  state: string | null
): string {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', issuerFor(origin))
  return url.toString()
}

export function codeRedirect(redirectUri: string, origin: string, code: string, state: string | null): string {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  url.searchParams.set('iss', issuerFor(origin))
  return url.toString()
}

export async function validateAuthorize(
  params: URLSearchParams,
  ctx: { origin: string; cfg: OAuthConfig; nowSeconds: number; fetcher?: MetadataFetcher }
): Promise<AuthorizeOutcome> {
  const { origin, cfg } = ctx
  if (!cfg.enabled || !cfg.secret) {
    return {
      kind: 'page',
      status: 503,
      title: 'Sign-in is off',
      message: 'Connecting Claude to Vesper is switched off on this server right now. Ask whoever runs Vesper at Loop.',
    }
  }
  const client = await resolveClient(params.get('client_id'), cfg, { fetcher: ctx.fetcher, nowMs: ctx.nowSeconds * 1000 })
  if (!client) {
    return {
      kind: 'page',
      status: 400,
      title: 'Unknown app',
      message: 'This sign-in link names an app Vesper does not know. Remove the connector in Claude and add it again.',
    }
  }
  const requested = params.get('redirect_uri')
  const redirectUri = requested ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
  if (
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    !isAllowedRedirectUri(redirectUri, cfg.redirectAllowlist)
  ) {
    return {
      kind: 'page',
      status: 400,
      title: 'This sign-in cannot continue',
      message:
        'The app asked Vesper to send you back to an address it did not register. Vesper stops here rather than send your sign-in somewhere unknown.',
    }
  }
  const state = params.get('state')
  const back = (error: string, description: string): AuthorizeOutcome => ({
    kind: 'redirect',
    location: errorRedirect(redirectUri, origin, error, description, state),
  })
  if (params.get('response_type') !== 'code') {
    return back('unsupported_response_type', 'Only response_type=code is supported.')
  }
  const challenge = params.get('code_challenge')
  if (params.get('code_challenge_method') !== 'S256' || !isValidChallenge(challenge)) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.')
  }
  const resourceParam = params.get('resource')
  const resource = resourceParam ? resourceParam.replace(/\/$/, '') : resourceUrl(origin)
  if (!acceptedResources(origin, cfg).includes(resource)) {
    return back('invalid_target', `This server protects ${resourceUrl(origin)} only.`)
  }
  const scopes = (params.get('scope') || OAUTH_SCOPE).split(/\s+/).filter(Boolean)
  if (scopes.some((s) => !(SCOPES_SUPPORTED as readonly string[]).includes(s))) {
    return back('invalid_scope', `Supported scopes: ${SCOPES_SUPPORTED.join(' ')}.`)
  }
  return {
    kind: 'consent',
    client,
    request: {
      clientId: client.clientId,
      clientName: client.name,
      redirectUri,
      state,
      codeChallenge: challenge,
      scope: OAUTH_SCOPE,
      resource,
      exp: ctx.nowSeconds + AUTH_REQUEST_TTL_SECONDS,
    },
  }
}

export function signAuthRequest(request: AuthRequest, secret: string): string {
  return signPayload(secret, 'authorize', request)
}

export function verifyAuthRequest(areq: unknown, secret: string | null, nowSeconds: number): AuthRequest | null {
  if (!secret || typeof areq !== 'string' || areq.length > 8000) return null
  const request = verifyPayload<AuthRequest>(secret, 'authorize', areq)
  if (!request || typeof request.exp !== 'number' || request.exp < nowSeconds) return null
  if (typeof request.redirectUri !== 'string' || typeof request.clientId !== 'string') return null
  return request
}
