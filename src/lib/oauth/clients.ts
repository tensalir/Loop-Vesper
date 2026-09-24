/**
 * OAuth clients, registered without a table.
 *
 * Dynamic client registration (RFC 7591) hands back a client id that carries
 * the client's registration inside it: its name, its redirect URIs and how it
 * authenticates, signed with `MCP_OAUTH_SECRET`. Nothing is stored, so anyone
 * may register, and a client id that was tampered with does not verify. A
 * client that authenticates with a secret gets one derived from its id, so the
 * token endpoint can check it again without storing it either.
 *
 * With `MCP_OAUTH_CIMD=1`, a client id may instead be the https URL of a
 * client metadata document on a host in `MCP_OAUTH_CIMD_HOSTS`; the document is
 * fetched (5 KB at most, cached ten minutes) and must name itself.
 */

import {
  CLIENT_ID_PREFIX,
  CLIENT_NAME_MAX,
  MAX_REDIRECT_URIS,
  OAUTH_SCOPE,
  type OAuthConfig,
} from './config'
import { hmac, safeEqual, signPayload, verifyPayload } from './crypto'
import { isAllowedRedirectUri } from './redirects'

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
const AUTH_METHODS: ClientAuthMethod[] = ['none', 'client_secret_post', 'client_secret_basic']

export interface ClientInfo {
  clientId: string
  name: string
  redirectUris: string[]
  authMethod: ClientAuthMethod
  issuedAt: number
  source: 'registration' | 'metadata-document'
}

interface ClientPayload {
  v: 1
  n: string
  r: string[]
  a: ClientAuthMethod
  t: number
}

export interface OAuthErrorBody {
  error: string
  error_description: string
}

export type RegisterResult =
  | { ok: true; status: 201; body: Record<string, unknown> }
  | { ok: false; status: 400; body: OAuthErrorBody }

function fail(error: string, description: string): RegisterResult {
  return { ok: false, status: 400, body: { error, error_description: description } }
}

export function clientSecretFor(clientId: string, secret: string): string {
  return hmac(secret, `client-secret:${clientId}`)
}

export function registerClient(
  body: unknown,
  cfg: Pick<OAuthConfig, 'secret' | 'redirectAllowlist'>,
  nowSeconds: number
): RegisterResult {
  if (!cfg.secret) return fail('temporarily_unavailable', 'Sign-in is not configured on this server.')
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_client_metadata', 'The registration must be a JSON object.')
  }
  const meta = body as Record<string, unknown>
  const uris = meta.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return fail('invalid_redirect_uri', `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs.`)
  }
  for (const uri of uris) {
    if (typeof uri !== 'string' || !isAllowedRedirectUri(uri, cfg.redirectAllowlist)) {
      return fail(
        'invalid_redirect_uri',
        `Redirect URI not allowed: ${String(uri).slice(0, 200)}. Vesper sends codes only to Claude's callback or to a loopback address.`
      )
    }
  }
  const method = (meta.token_endpoint_auth_method ?? 'client_secret_basic') as ClientAuthMethod
  if (!AUTH_METHODS.includes(method)) {
    return fail('invalid_client_metadata', `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}.`)
  }
  const grants = meta.grant_types
  if (grants !== undefined) {
    if (!Array.isArray(grants) || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      return fail('invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token.')
    }
  }
  const responses = meta.response_types
  if (responses !== undefined) {
    if (!Array.isArray(responses) || responses.some((r) => r !== 'code')) {
      return fail('invalid_client_metadata', 'response_types may only be code.')
    }
  }
  const rawName = typeof meta.client_name === 'string' ? meta.client_name : 'MCP client'
  const name = rawName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CLIENT_NAME_MAX) || 'MCP client'
  const payload: ClientPayload = { v: 1, n: name, r: uris as string[], a: method, t: nowSeconds }
  const clientId = `${CLIENT_ID_PREFIX}${signPayload(cfg.secret, 'client', payload)}`
  const out: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: nowSeconds,
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: `${OAUTH_SCOPE} offline_access`,
  }
  if (method !== 'none') {
    out.client_secret = clientSecretFor(clientId, cfg.secret)
    out.client_secret_expires_at = 0
  }
  return { ok: true, status: 201, body: out }
}

/** A registered client id, checked; null when it was not issued here or was altered. */
export function parseClientId(clientId: unknown, secret: string | null): ClientInfo | null {
  if (!secret || typeof clientId !== 'string' || !clientId.startsWith(CLIENT_ID_PREFIX)) return null
  if (clientId.length > 4000) return null
  const payload = verifyPayload<ClientPayload>(secret, 'client', clientId.slice(CLIENT_ID_PREFIX.length))
  if (!payload || payload.v !== 1 || !Array.isArray(payload.r) || !AUTH_METHODS.includes(payload.a)) return null
  return {
    clientId,
    name: String(payload.n || 'MCP client'),
    redirectUris: payload.r.map(String),
    authMethod: payload.a,
    issuedAt: Number(payload.t) || 0,
    source: 'registration',
  }
}

export type MetadataFetcher = (url: string) => Promise<unknown>

const cimdCache = new Map<string, { at: number; info: ClientInfo | null }>()
const CIMD_TTL_MS = 10 * 60 * 1000
const CIMD_MAX_BYTES = 5 * 1024

/** Fetch a client metadata document: https, the configured hosts, no redirects, 5 KB, 5 s. */
export const defaultMetadataFetcher: MetadataFetcher = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const text = await res.text()
    if (text.length > CIMD_MAX_BYTES) return null
    return JSON.parse(text)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveMetadataDocument(
  clientId: string,
  cfg: Pick<OAuthConfig, 'cimd' | 'cimdHosts' | 'redirectAllowlist'>,
  fetcher: MetadataFetcher,
  nowMs: number
): Promise<ClientInfo | null> {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hash || !cfg.cimdHosts.includes(url.hostname.toLowerCase())) return null
  const cached = cimdCache.get(clientId)
  if (cached && nowMs - cached.at < CIMD_TTL_MS) return cached.info
  const doc = (await fetcher(clientId)) as Record<string, unknown> | null
  let info: ClientInfo | null = null
  if (doc && typeof doc === 'object' && doc.client_id === clientId && Array.isArray(doc.redirect_uris)) {
    const uris = (doc.redirect_uris as unknown[]).filter(
      (u): u is string => typeof u === 'string' && isAllowedRedirectUri(u, cfg.redirectAllowlist)
    )
    if (uris.length > 0) {
      info = {
        clientId,
        name: String(doc.client_name || url.hostname).slice(0, CLIENT_NAME_MAX),
        redirectUris: uris,
        authMethod: 'none',
        issuedAt: 0,
        source: 'metadata-document',
      }
    }
  }
  cimdCache.set(clientId, { at: nowMs, info })
  return info
}

export async function resolveClient(
  clientId: unknown,
  cfg: Pick<OAuthConfig, 'secret' | 'cimd' | 'cimdHosts' | 'redirectAllowlist'>,
  opts: { fetcher?: MetadataFetcher; nowMs?: number } = {}
): Promise<ClientInfo | null> {
  if (typeof clientId !== 'string' || !clientId) return null
  if (clientId.startsWith('https://')) {
    if (!cfg.cimd) return null
    return resolveMetadataDocument(clientId, cfg, opts.fetcher ?? defaultMetadataFetcher, opts.nowMs ?? Date.now())
  }
  return parseClientId(clientId, cfg.secret)
}

/** Client credentials as the token endpoint received them. */
export interface PresentedClient {
  clientId: string | null
  clientSecret: string | null
  via: 'basic' | 'post' | 'none'
}

export function presentedClient(authorization: string | null, form: URLSearchParams): PresentedClient | 'malformed' {
  if (authorization && /^Basic\s+/i.test(authorization)) {
    let decoded: string
    try {
      decoded = Buffer.from(authorization.replace(/^Basic\s+/i, ''), 'base64').toString('utf8')
    } catch {
      return 'malformed'
    }
    const colon = decoded.indexOf(':')
    if (colon < 0) return 'malformed'
    const id = decodeURIComponent(decoded.slice(0, colon))
    const secret = decodeURIComponent(decoded.slice(colon + 1))
    const formId = form.get('client_id')
    if (formId && formId !== id) return 'malformed'
    return { clientId: id, clientSecret: secret, via: 'basic' }
  }
  const id = form.get('client_id')
  const secret = form.get('client_secret')
  return { clientId: id, clientSecret: secret, via: secret ? 'post' : 'none' }
}

/**
 * Whether the presented credentials authenticate the client. A public client
 * (`none`) is authenticated by PKCE instead; a secret it sends anyway is
 * ignored. A confidential client must send its secret, by either method.
 */
export function authenticateClient(client: ClientInfo, presented: PresentedClient, secret: string): boolean {
  if (presented.clientId !== client.clientId) return false
  if (client.authMethod === 'none') return true
  if (!presented.clientSecret) return false
  return safeEqual(presented.clientSecret, clientSecretFor(client.clientId, secret))
}

/** For tests: forget cached metadata documents. */
export function clearClientMetadataCache(): void {
  cimdCache.clear()
}
