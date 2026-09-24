/**
 * Codes and tokens: issuing, exchanging, refreshing, revoking, and checking an
 * access token on a request.
 *
 * - A code lives five minutes and is used once. Presenting it a second time
 *   revokes every token it issued (RFC 6749 §4.1.2).
 * - An access token (`vsp_oat_…`) lives one hour. A refresh token (`vsp_ort_…`)
 *   rotates on every use; it lives 30 days from its issue, and no token of a
 *   family outlives 180 days from the sign-in.
 * - A spent refresh token presented again within 60 seconds gets a sibling
 *   pair: a retry, or two refreshes racing, must not lock a person out. Past
 *   that window it is treated as stolen and the whole family is revoked.
 * - Every refusal at the token endpoint answers `invalid_grant` and says no
 *   more, so a probe learns nothing.
 */

import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_ABSOLUTE_SECONDS,
  REFRESH_GRACE_SECONDS,
  REFRESH_SLIDING_SECONDS,
  REFRESH_TOKEN_PREFIX,
} from './config'
import type { OAuthErrorBody } from './clients'
import { randomB64url, randomUuid, sha256Hex } from './crypto'
import { verifyPkce } from './pkce'
import type { AuthRequest } from './request'
import type { CredentialState, NewToken, OAuthOwner, OAuthStore, TokenRecord } from './store'

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export type GrantResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: 400; body: OAuthErrorBody }

const INVALID_GRANT: GrantResult = {
  ok: false,
  status: 400,
  body: { error: 'invalid_grant', error_description: 'The grant is invalid, expired or already used.' },
}

export function hashToken(raw: string): string {
  return sha256Hex(raw)
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000)
}

export async function issueCode(
  store: OAuthStore,
  input: { request: AuthRequest; profileId: string; credentialId: string; now: Date }
): Promise<string> {
  const raw = randomB64url(32)
  await store.createCode({
    codeHash: hashToken(raw),
    profileId: input.profileId,
    credentialId: input.credentialId,
    clientId: input.request.clientId,
    redirectUri: input.request.redirectUri,
    codeChallenge: input.request.codeChallenge,
    scope: input.request.scope,
    resource: input.request.resource,
    expiresAt: addSeconds(input.now, CODE_TTL_SECONDS),
  })
  return raw
}

async function issuePair(
  store: OAuthStore,
  base: { credentialId: string; clientId: string; scope: string; resource: string; familyId: string; familyExpiresAt: Date; parentId: string | null; codeId: string | null },
  now: Date
): Promise<TokenResponse> {
  const access = `${ACCESS_TOKEN_PREFIX}${randomB64url(32)}`
  const refresh = `${REFRESH_TOKEN_PREFIX}${randomB64url(32)}`
  const refreshExpires = new Date(
    Math.min(addSeconds(now, REFRESH_SLIDING_SECONDS).getTime(), base.familyExpiresAt.getTime())
  )
  const accessExpires = new Date(
    Math.min(addSeconds(now, ACCESS_TOKEN_TTL_SECONDS).getTime(), base.familyExpiresAt.getTime())
  )
  const rows: NewToken[] = [
    { ...base, kind: 'access', tokenHash: hashToken(access), expiresAt: accessExpires },
    { ...base, kind: 'refresh', tokenHash: hashToken(refresh), expiresAt: refreshExpires },
  ]
  await store.createTokens(rows)
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.round((accessExpires.getTime() - now.getTime()) / 1000)),
    refresh_token: refresh,
    scope: base.scope,
  }
}

async function credentialUsable(store: OAuthStore, credentialId: string): Promise<boolean> {
  const state = await store.credentialState(credentialId)
  return Boolean(state && state.kind === 'oauth' && !state.revokedAt)
}

export async function exchangeCode(
  store: OAuthStore,
  input: { code: string | null; codeVerifier: string | null; redirectUri: string | null; clientId: string; resource: string | null; now: Date }
): Promise<GrantResult> {
  if (!input.code) return INVALID_GRANT
  const hash = hashToken(input.code)
  const code = await store.consumeCode(hash, input.now)
  if (!code) {
    const seen = await store.findCode(hash)
    if (seen?.usedAt) await store.revokeTokensFromCode(seen.id, input.now)
    return INVALID_GRANT
  }
  if (code.clientId !== input.clientId) return INVALID_GRANT
  if (!input.redirectUri || input.redirectUri !== code.redirectUri) return INVALID_GRANT
  if (!verifyPkce(input.codeVerifier, code.codeChallenge)) return INVALID_GRANT
  if (input.resource && input.resource.replace(/\/$/, '') !== code.resource) return INVALID_GRANT
  if (!(await credentialUsable(store, code.credentialId))) return INVALID_GRANT
  const body = await issuePair(
    store,
    {
      credentialId: code.credentialId,
      clientId: code.clientId,
      scope: code.scope,
      resource: code.resource,
      familyId: randomUuid(),
      familyExpiresAt: addSeconds(input.now, REFRESH_ABSOLUTE_SECONDS),
      parentId: null,
      codeId: code.id,
    },
    input.now
  )
  return { ok: true, body }
}

export async function refreshGrant(
  store: OAuthStore,
  input: { refreshToken: string | null; clientId: string; now: Date }
): Promise<GrantResult> {
  if (!input.refreshToken || !input.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return INVALID_GRANT
  const token = await store.findToken(hashToken(input.refreshToken))
  if (!token || token.kind !== 'refresh') return INVALID_GRANT
  if (token.clientId !== input.clientId) return INVALID_GRANT
  const now = input.now
  if (token.revokedAt || token.expiresAt <= now || token.familyExpiresAt <= now) return INVALID_GRANT
  if (!(await credentialUsable(store, token.credentialId))) return INVALID_GRANT

  let usedAt = token.usedAt
  if (!usedAt) {
    const mine = await store.markTokenUsed(token.id, now)
    // Lost the race to a concurrent refresh: it was used a moment ago.
    usedAt = mine ? null : now
  }
  if (usedAt && now.getTime() - usedAt.getTime() > REFRESH_GRACE_SECONDS * 1000) {
    await store.revokeFamily(token.familyId, now)
    return INVALID_GRANT
  }
  const body = await issuePair(
    store,
    {
      credentialId: token.credentialId,
      clientId: token.clientId,
      scope: token.scope,
      resource: token.resource,
      familyId: token.familyId,
      familyExpiresAt: token.familyExpiresAt,
      parentId: token.id,
      codeId: token.codeId,
    },
    now
  )
  return { ok: true, body }
}

/** RFC 7009: revoke the token's whole family if it is ours; say nothing either way. */
export async function revokeToken(store: OAuthStore, raw: string | null, clientId: string | null, now: Date): Promise<void> {
  if (!raw) return
  const token = await store.findToken(hashToken(raw))
  if (!token) return
  if (clientId && token.clientId !== clientId) return
  await store.revokeFamily(token.familyId, now)
}

export type AccessCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string; invalidToken: boolean }

/**
 * Whether an access token found by its hash may make this request. The caller
 * then applies the same checks as for any credential (rate limits, tools).
 */
export function checkAccess(
  found: { token: TokenRecord; credential: CredentialState; owner: OAuthOwner } | null,
  ctx: { now: Date; resources: string[] }
): AccessCheck {
  const invalid = (message: string): AccessCheck => ({ ok: false, status: 401, message, invalidToken: true })
  if (!found || found.token.kind !== 'access') return invalid('The access token is not valid.')
  const { token, credential, owner } = found
  if (token.revokedAt) return invalid('The access token was revoked. Connect Vesper again.')
  if (token.expiresAt <= ctx.now) return invalid('The access token expired.')
  if (!ctx.resources.includes(token.resource)) return invalid('The access token was issued for another server.')
  if (credential.revokedAt || credential.kind !== 'oauth') return invalid('This connection was removed. Connect Vesper again.')
  if (owner.deletedAt) return { ok: false, status: 403, message: 'This Vesper account has been deleted.', invalidToken: false }
  if (owner.pausedAt) return { ok: false, status: 403, message: 'This Vesper account is paused.', invalidToken: false }
  if (!owner.mcpAccess && owner.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      message: 'Claude access is not turned on for this Vesper account. Ask whoever runs Vesper at Loop to turn it on.',
      invalidToken: false,
    }
  }
  return { ok: true }
}
