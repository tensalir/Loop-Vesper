import { test, expect } from '@playwright/test'
import { registerClient } from '../src/lib/oauth/clients'
import type { OAuthConfig } from '../src/lib/oauth/config'
import { s256 } from '../src/lib/oauth/pkce'
import { signAuthRequest, validateAuthorize, verifyAuthRequest, type AuthRequest } from '../src/lib/oauth/request'
import { checkAccess, exchangeCode, hashToken, issueCode, refreshGrant, revokeToken } from '../src/lib/oauth/tokens'
import type { OAuthOwner } from '../src/lib/oauth/store'
import { MemoryOAuthStore } from './helpers/memory-oauth-store'

/**
 * The sign-in end to end over an in-memory store: authorize, consent, code,
 * tokens, refresh, revoke, and the check every request to /api/mcp makes.
 */

const ORIGIN = 'https://vesper.example'
const RESOURCE = `${ORIGIN}/api/mcp`
const SECRET = 'k'.repeat(48)
const cfg: OAuthConfig = { enabled: true, secret: SECRET, cimd: false, cimdHosts: [], redirectAllowlist: [], resourceAliases: [] }
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = s256(VERIFIER)
const T0 = new Date('2026-10-01T09:00:00Z')
const sec = (d: Date) => Math.floor(d.getTime() / 1000)
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

function publicClient(): string {
  const res = registerClient({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }, cfg, sec(T0))
  if (!res.ok) throw new Error('registration failed')
  return res.body.client_id as string
}

function authorizeParams(clientId: string, over: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st-123',
    resource: RESOURCE,
    scope: 'mcp:tools offline_access',
    ...over,
  }
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(base)) if (v !== null) p.set(k, v)
  return p
}

async function consent(clientId: string, over: Record<string, string | null> = {}) {
  const out = await validateAuthorize(authorizeParams(clientId, over), { origin: ORIGIN, cfg, nowSeconds: sec(T0) })
  if (out.kind !== 'consent') throw new Error(`expected consent, got ${out.kind}`)
  return out.request
}

async function signedIn(store: MemoryOAuthStore, clientId: string, now = T0) {
  const request = await consent(clientId)
  const cred = await store.upsertCredential({
    ownerId: 'person-1',
    clientKey: 'claude.ai',
    clientId,
    clientName: 'Claude',
    subjectEmail: 'p@loop.example',
  })
  const code = await issueCode(store, { request, profileId: 'person-1', credentialId: cred.id, now })
  return { request, code, credentialId: cred.id }
}

async function tokens(store: MemoryOAuthStore, clientId: string) {
  const { code, credentialId } = await signedIn(store, clientId)
  const res = await exchangeCode(store, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId, resource: RESOURCE, now: at(10) })
  if (!res.ok) throw new Error('exchange failed')
  return { ...res.body, credentialId }
}

test.describe('authorize', () => {
  test('an unknown client or an unregistered redirect stops on a page, never a redirect', async () => {
    const clientId = publicClient()
    const unknown = await validateAuthorize(authorizeParams('vmc_forged.sig'), { origin: ORIGIN, cfg, nowSeconds: sec(T0) })
    expect(unknown.kind).toBe('page')
    const otherRedirect = await validateAuthorize(authorizeParams(clientId, { redirect_uri: 'http://localhost:1/callback' }), {
      origin: ORIGIN,
      cfg,
      nowSeconds: sec(T0),
    })
    expect(otherRedirect.kind).toBe('page')
    const evil = await validateAuthorize(authorizeParams(clientId, { redirect_uri: 'https://evil.example/cb' }), {
      origin: ORIGIN,
      cfg,
      nowSeconds: sec(T0),
    })
    expect(evil.kind).toBe('page')
    const off = await validateAuthorize(authorizeParams(clientId), { origin: ORIGIN, cfg: { ...cfg, enabled: false }, nowSeconds: sec(T0) })
    expect(off.kind).toBe('page')
  })

  test('missing or plain PKCE, a wrong response type, resource or scope go back to the client with state and iss', async () => {
    const clientId = publicClient()
    const cases: Array<[Record<string, string | null>, string]> = [
      [{ code_challenge: null }, 'invalid_request'],
      [{ code_challenge_method: 'plain', code_challenge: VERIFIER.slice(0, 43) }, 'invalid_request'],
      [{ code_challenge_method: null }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/api/mcp' }, 'invalid_target'],
      [{ scope: 'mcp:tools admin' }, 'invalid_scope'],
    ]
    for (const [over, error] of cases) {
      const out = await validateAuthorize(authorizeParams(clientId, over), { origin: ORIGIN, cfg, nowSeconds: sec(T0) })
      expect(out.kind, JSON.stringify(over)).toBe('redirect')
      if (out.kind !== 'redirect') continue
      const url = new URL(out.location)
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
      expect(url.searchParams.get('error')).toBe(error)
      expect(url.searchParams.get('state')).toBe('st-123')
      expect(url.searchParams.get('iss')).toBe(ORIGIN)
    }
  })

  test('a good request goes to consent; no resource means this server; one registered redirect may be omitted', async () => {
    const clientId = publicClient()
    const request = await consent(clientId, { resource: null, redirect_uri: null })
    expect(request.resource).toBe(RESOURCE)
    expect(request.redirectUri).toBe(REDIRECT)
    expect(request.scope).toBe('mcp:tools')
    expect(request.exp).toBe(sec(T0) + 600)
  })

  test('the signed request expires after ten minutes and cannot be altered', async () => {
    const request = await consent(publicClient())
    const areq = signAuthRequest(request, SECRET)
    expect(verifyAuthRequest(areq, SECRET, sec(T0) + 599)).toEqual(request)
    expect(verifyAuthRequest(areq, SECRET, sec(T0) + 601)).toBeNull()
    expect(verifyAuthRequest(areq, 'z'.repeat(48), sec(T0))).toBeNull()
    const tampered: AuthRequest = { ...request, redirectUri: 'https://evil.example/cb' }
    const forged = signAuthRequest(tampered, 'z'.repeat(48))
    expect(verifyAuthRequest(forged, SECRET, sec(T0))).toBeNull()
    const [body, sig] = areq.split('.')
    expect(verifyAuthRequest(`${body}x.${sig}`, SECRET, sec(T0))).toBeNull()
  })
})

test.describe('codes', () => {
  test('a code is exchanged once for a bearer pair', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    expect(pair.access_token).toMatch(/^vsp_oat_[A-Za-z0-9_-]{43}$/)
    expect(pair.refresh_token).toMatch(/^vsp_ort_[A-Za-z0-9_-]{43}$/)
    expect(pair.token_type).toBe('Bearer')
    expect(pair.expires_in).toBe(3600)
    expect(pair.scope).toBe('mcp:tools')
    const access = store.tokenRow(hashToken(pair.access_token))!
    expect(access.resource).toBe(RESOURCE)
    // Only hashes are stored.
    expect(Array.from(store.tokens.keys()).some((k) => k.includes('vsp_'))).toBe(false)
  })

  test('each mismatch is invalid_grant: client, redirect, verifier, resource, expiry', async () => {
    const clientId = publicClient()
    const other = registerClient({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }, cfg, sec(T0) + 1)
    if (!other.ok) throw new Error('registration failed')
    const mismatches: Array<Record<string, unknown>> = [
      { clientId: other.body.client_id },
      { redirectUri: 'http://localhost:1/callback' },
      { redirectUri: null },
      { codeVerifier: 'w'.repeat(64) },
      { codeVerifier: null },
      { resource: 'https://other.example/api/mcp' },
      { now: at(301) },
    ]
    for (const over of mismatches) {
      const store = new MemoryOAuthStore()
      const { code } = await signedIn(store, clientId)
      const res = await exchangeCode(store, {
        code,
        codeVerifier: VERIFIER,
        redirectUri: REDIRECT,
        clientId,
        resource: RESOURCE,
        now: at(10),
        ...over,
      } as Parameters<typeof exchangeCode>[1])
      expect(res.ok, JSON.stringify(over)).toBe(false)
      if (!res.ok) expect(res.body.error).toBe('invalid_grant')
    }
  })

  test('presenting a used code again revokes every token it issued', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const { code } = await signedIn(store, clientId)
    const first = await exchangeCode(store, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId, resource: null, now: at(10) })
    expect(first.ok).toBe(true)
    const again = await exchangeCode(store, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId, resource: null, now: at(20) })
    expect(again.ok).toBe(false)
    if (!first.ok) return
    expect(store.tokenRow(hashToken(first.body.access_token))!.revokedAt).not.toBeNull()
    expect(store.tokenRow(hashToken(first.body.refresh_token))!.revokedAt).not.toBeNull()
  })

  test('a code for a credential revoked in the meantime is refused', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const { code, credentialId } = await signedIn(store, clientId)
    await store.revokeCredential('person-1', credentialId, at(5))
    const res = await exchangeCode(store, { code, codeVerifier: VERIFIER, redirectUri: REDIRECT, clientId, resource: null, now: at(10) })
    expect(res.ok).toBe(false)
  })
})

test.describe('refresh', () => {
  test('a refresh token rotates: the new pair works, the family is shared', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    const next = await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(3000) })
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.body.refresh_token).not.toBe(pair.refresh_token)
    const oldRow = store.tokenRow(hashToken(pair.refresh_token))!
    const newRow = store.tokenRow(hashToken(next.body.refresh_token))!
    expect(newRow.familyId).toBe(oldRow.familyId)
    expect(newRow.parentId).toBe(oldRow.id)
    expect(oldRow.usedAt).not.toBeNull()
  })

  test('the same refresh token again within 60 seconds gets a sibling pair', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    const a = await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(1000) })
    const b = await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(1050) })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.body.access_token).not.toBe(a.body.access_token)
    expect(store.tokenRow(hashToken(a.body.access_token))!.revokedAt).toBeNull()
  })

  test('replayed after the grace window, the whole family is revoked', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    const a = await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(1000) })
    expect(a.ok).toBe(true)
    const replay = await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(1061) })
    expect(replay.ok).toBe(false)
    if (!a.ok) return
    expect(store.tokenRow(hashToken(a.body.access_token))!.revokedAt).not.toBeNull()
    expect(store.tokenRow(hashToken(a.body.refresh_token))!.revokedAt).not.toBeNull()
    const afterwards = await refreshGrant(store, { refreshToken: a.body.refresh_token, clientId, now: at(1070) })
    expect(afterwards.ok).toBe(false)
  })

  test('refused: another client, an access token, a revoked credential, an expired token, the 180-day cap', async () => {
    const clientId = publicClient()
    const other = registerClient({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }, cfg, sec(T0) + 1)
    if (!other.ok) throw new Error('registration failed')

    let store = new MemoryOAuthStore()
    let pair = await tokens(store, clientId)
    expect((await refreshGrant(store, { refreshToken: pair.refresh_token, clientId: other.body.client_id as string, now: at(100) })).ok).toBe(false)
    expect((await refreshGrant(store, { refreshToken: pair.access_token, clientId, now: at(100) })).ok).toBe(false)

    store = new MemoryOAuthStore()
    pair = await tokens(store, clientId)
    await store.revokeCredential('person-1', pair.credentialId, at(50))
    expect((await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(100) })).ok).toBe(false)

    store = new MemoryOAuthStore()
    pair = await tokens(store, clientId)
    expect((await refreshGrant(store, { refreshToken: pair.refresh_token, clientId, now: at(31 * 86400) })).ok).toBe(false)

    // Refresh every 20 days: fine until the family reaches 180 days, then refused.
    store = new MemoryOAuthStore()
    pair = await tokens(store, clientId)
    let refresh = pair.refresh_token
    let day = 0
    let refused = false
    while (day < 200) {
      day += 20
      const res = await refreshGrant(store, { refreshToken: refresh, clientId, now: at(day * 86400) })
      if (!res.ok) {
        refused = true
        break
      }
      refresh = res.body.refresh_token
      const row = store.tokenRow(hashToken(refresh))!
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.familyExpiresAt.getTime())
    }
    expect(refused).toBe(true)
    expect(day).toBeGreaterThan(180)
  })
})

test.describe('revocation', () => {
  test('revoking either token of a pair revokes the family; an unknown token is a quiet no-op', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    await revokeToken(store, 'vsp_ort_unknown', clientId, at(20))
    expect(store.tokenRow(hashToken(pair.access_token))!.revokedAt).toBeNull()
    await revokeToken(store, pair.refresh_token, clientId, at(30))
    expect(store.tokenRow(hashToken(pair.access_token))!.revokedAt).not.toBeNull()
  })

  test('disconnecting in Settings revokes the credential and its tokens', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    expect(await store.listConnectedApps('person-1')).toHaveLength(1)
    expect(await store.revokeCredential('person-2', pair.credentialId, at(40))).toBe(false)
    expect(await store.revokeCredential('person-1', pair.credentialId, at(40))).toBe(true)
    expect(store.tokenRow(hashToken(pair.refresh_token))!.revokedAt).not.toBeNull()
    expect(await store.listConnectedApps('person-1')).toHaveLength(0)
  })

  test('signing in again from the same client reuses the one credential', async () => {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const a = await signedIn(store, clientId)
    const b = await signedIn(store, clientId)
    expect(b.credentialId).toBe(a.credentialId)
  })
})

test.describe('the check on every request', () => {
  const owner: OAuthOwner = { id: 'person-1', role: 'user', pausedAt: null, deletedAt: null, mcpAccess: true }

  async function found(over: { owner?: Partial<OAuthOwner>; credentialRevoked?: boolean; resource?: string } = {}) {
    const store = new MemoryOAuthStore()
    const clientId = publicClient()
    const pair = await tokens(store, clientId)
    const token = store.tokenRow(hashToken(pair.access_token))!
    if (over.resource) token.resource = over.resource
    return {
      store,
      pair,
      value: {
        token,
        credential: { id: pair.credentialId, ownerId: 'person-1', kind: 'oauth', revokedAt: over.credentialRevoked ? at(1) : null },
        owner: { ...owner, ...over.owner },
      },
    }
  }

  test('an active token of a person with Claude access passes; an admin passes without the flag', async () => {
    const { value } = await found()
    expect(checkAccess(value, { now: at(100), resources: [RESOURCE] })).toEqual({ ok: true })
    const admin = await found({ owner: { role: 'admin', mcpAccess: false } })
    expect(checkAccess(admin.value, { now: at(100), resources: [RESOURCE] }).ok).toBe(true)
  })

  test('expired, revoked, removed, or for another server: 401 with a challenge', async () => {
    const expired = await found()
    const r1 = checkAccess(expired.value, { now: at(3700), resources: [RESOURCE] })
    expect(r1.ok === false && r1.status === 401 && r1.invalidToken).toBe(true)

    const revoked = await found()
    await revokeToken(revoked.store, revoked.pair.access_token, null, at(20))
    const r2 = checkAccess({ ...revoked.value, token: revoked.store.tokenRow(hashToken(revoked.pair.access_token))! }, { now: at(100), resources: [RESOURCE] })
    expect(r2.ok === false && r2.status === 401).toBe(true)

    const removed = await found({ credentialRevoked: true })
    const r3 = checkAccess(removed.value, { now: at(100), resources: [RESOURCE] })
    expect(r3.ok === false && r3.status === 401).toBe(true)

    const elsewhere = await found({ resource: 'https://other.example/api/mcp' })
    const r4 = checkAccess(elsewhere.value, { now: at(100), resources: [RESOURCE] })
    expect(r4.ok === false && r4.status === 401).toBe(true)
    expect(checkAccess(elsewhere.value, { now: at(100), resources: [RESOURCE, 'https://other.example/api/mcp'] }).ok).toBe(true)

    expect(checkAccess(null, { now: at(100), resources: [RESOURCE] }).ok).toBe(false)
  })

  test('a paused or deleted person, or Claude access removed: 403, no challenge', async () => {
    for (const over of [{ pausedAt: at(1) }, { deletedAt: at(1) }, { mcpAccess: false }] as Array<Partial<OAuthOwner>>) {
      const { value } = await found({ owner: over })
      const r = checkAccess(value, { now: at(100), resources: [RESOURCE] })
      expect(r.ok === false && r.status === 403 && !r.invalidToken, JSON.stringify(over)).toBe(true)
    }
  })

  test('a refresh token is never accepted as an access token', async () => {
    const { store, pair, value } = await found()
    const refreshRow = store.tokenRow(hashToken(pair.refresh_token))!
    expect(checkAccess({ ...value, token: refreshRow }, { now: at(100), resources: [RESOURCE] }).ok).toBe(false)
  })
})
