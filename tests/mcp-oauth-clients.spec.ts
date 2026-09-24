import { test, expect } from '@playwright/test'
import {
  authenticateClient,
  clearClientMetadataCache,
  clientSecretFor,
  parseClientId,
  presentedClient,
  registerClient,
  resolveClient,
} from '../src/lib/oauth/clients'
import type { OAuthConfig } from '../src/lib/oauth/config'
import { clientKeyFor, isAllowedRedirectUri } from '../src/lib/oauth/redirects'

/** Registration without a table: the client id carries the registration, signed. */

const SECRET = 's'.repeat(48)
const cfg: OAuthConfig = {
  enabled: true,
  secret: SECRET,
  cimd: false,
  cimdHosts: [],
  redirectAllowlist: [],
  resourceAliases: [],
}
const NOW = 1_790_000_000

function register(body: Record<string, unknown>, config: OAuthConfig = cfg) {
  return registerClient(body, config, NOW)
}

test.describe('redirect URIs', () => {
  test("Claude's callbacks and loopback on any port are allowed", () => {
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'http://localhost:33418/callback',
      'http://127.0.0.1:6274/oauth/callback',
      'http://[::1]:5000/callback',
      'http://localhost:6274/oauth/callback/debug',
    ]) {
      expect(isAllowedRedirectUri(uri), uri).toBe(true)
    }
  })

  test('other hosts, http off loopback, other paths and fragments are refused', () => {
    for (const uri of [
      'https://evil.example/cb',
      'https://claude.ai/other',
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'http://example.com:8080/callback',
      'http://localhost:3000/somewhere',
      'https://claude.ai/api/mcp/auth_callback#frag',
      'http://user:pw@localhost:5000/callback',
      'not a url',
    ]) {
      expect(isAllowedRedirectUri(uri), uri).toBe(false)
    }
    expect(isAllowedRedirectUri('https://app.example/cb', ['https://app.example/cb'])).toBe(true)
  })

  test('the client key groups a person’s grants by where the code goes', () => {
    expect(clientKeyFor('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai')
    expect(clientKeyFor('https://claude.com/api/mcp/auth_callback')).toBe('claude.com')
    expect(clientKeyFor('http://localhost:33418/callback')).toBe('loopback')
  })
})

test.describe('registration', () => {
  test('a public client registers and its id round-trips', () => {
    const res = register({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.status).toBe(201)
    expect(res.body.client_secret).toBeUndefined()
    const info = parseClientId(res.body.client_id, SECRET)
    expect(info).not.toBeNull()
    expect(info!.name).toBe('Claude')
    expect(info!.redirectUris).toEqual(['https://claude.ai/api/mcp/auth_callback'])
    expect(info!.authMethod).toBe('none')
  })

  test('with no method named, the RFC default gives a secret that authenticates', () => {
    const res = register({ client_name: 'Desk', redirect_uris: ['http://localhost:9999/callback'] })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.body.token_endpoint_auth_method).toBe('client_secret_basic')
    const id = res.body.client_id as string
    expect(res.body.client_secret).toBe(clientSecretFor(id, SECRET))
    const info = parseClientId(id, SECRET)!
    expect(authenticateClient(info, { clientId: id, clientSecret: res.body.client_secret as string, via: 'basic' }, SECRET)).toBe(true)
    expect(authenticateClient(info, { clientId: id, clientSecret: 'wrong', via: 'post' }, SECRET)).toBe(false)
    expect(authenticateClient(info, { clientId: id, clientSecret: null, via: 'none' }, SECRET)).toBe(false)
  })

  test('a public client is not asked for a secret, and a secret it sends is ignored', () => {
    const res = register({ redirect_uris: ['http://localhost:1/callback'], token_endpoint_auth_method: 'none' })
    if (!res.ok) throw new Error('registration failed')
    const info = parseClientId(res.body.client_id, SECRET)!
    expect(authenticateClient(info, { clientId: info.clientId, clientSecret: null, via: 'none' }, SECRET)).toBe(true)
    expect(authenticateClient(info, { clientId: 'someone-else', clientSecret: null, via: 'none' }, SECRET)).toBe(false)
  })

  test('refused: another host, no URIs, a fragment, an unknown method or grant', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ redirect_uris: ['https://evil.example/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: [] }, 'invalid_redirect_uri'],
      [{}, 'invalid_redirect_uri'],
      [{ redirect_uris: ['https://claude.ai/api/mcp/auth_callback#x'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['http://localhost:1/callback'], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
      [{ redirect_uris: ['http://localhost:1/callback'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ redirect_uris: ['http://localhost:1/callback'], response_types: ['token'] }, 'invalid_client_metadata'],
    ]
    for (const [body, error] of cases) {
      const res = register(body)
      expect(res.ok, JSON.stringify(body)).toBe(false)
      if (!res.ok) expect(res.body.error).toBe(error)
    }
    const noSecret = registerClient({ redirect_uris: ['http://localhost:1/callback'] }, { ...cfg, secret: null }, NOW)
    expect(noSecret.ok).toBe(false)
  })

  test('a client id changed by one character, or signed with another secret, is not ours', () => {
    const res = register({ redirect_uris: ['http://localhost:1/callback'], token_endpoint_auth_method: 'none' })
    if (!res.ok) throw new Error('registration failed')
    const id = res.body.client_id as string
    const flipped = id.slice(0, 10) + (id[10] === 'A' ? 'B' : 'A') + id.slice(11)
    expect(parseClientId(flipped, SECRET)).toBeNull()
    expect(parseClientId(id, 'o'.repeat(48))).toBeNull()
    expect(parseClientId('vesper-mcp-public', SECRET)).toBeNull()
  })

  test('names are cut to 80 characters and cleaned of control characters', () => {
    const res = register({ client_name: 'A\u0000B' + 'x'.repeat(200), redirect_uris: ['http://localhost:1/callback'] })
    if (!res.ok) throw new Error('registration failed')
    expect(String(res.body.client_name).length).toBe(80)
    expect(String(res.body.client_name).startsWith('AB')).toBe(true)
  })
})

test.describe('client credentials at the token endpoint', () => {
  test('basic and post are both read; a basic id that disagrees with the form is malformed', () => {
    const basic = `Basic ${Buffer.from('vmc_id:sec').toString('base64')}`
    expect(presentedClient(basic, new URLSearchParams())).toEqual({ clientId: 'vmc_id', clientSecret: 'sec', via: 'basic' })
    expect(presentedClient(basic, new URLSearchParams('client_id=other'))).toBe('malformed')
    expect(presentedClient(null, new URLSearchParams('client_id=a&client_secret=b'))).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      via: 'post',
    })
    expect(presentedClient(null, new URLSearchParams('client_id=a'))).toEqual({ clientId: 'a', clientSecret: null, via: 'none' })
  })
})

test.describe('client metadata documents', () => {
  test('only when switched on, only from the listed hosts, and the document must name itself', async () => {
    clearClientMetadataCache()
    const url = 'https://clients.example/claude.json'
    const doc = { client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }
    const fetcher = async () => doc
    expect(await resolveClient(url, cfg, { fetcher })).toBeNull()
    const on = { ...cfg, cimd: true, cimdHosts: ['clients.example'] }
    const info = await resolveClient(url, on, { fetcher })
    expect(info?.source).toBe('metadata-document')
    expect(info?.authMethod).toBe('none')
    clearClientMetadataCache()
    expect(await resolveClient('https://other.example/c.json', on, { fetcher })).toBeNull()
    clearClientMetadataCache()
    expect(await resolveClient(url, on, { fetcher: async () => ({ ...doc, client_id: 'https://x/y' }) })).toBeNull()
    clearClientMetadataCache()
    expect(
      await resolveClient(url, on, { fetcher: async () => ({ ...doc, redirect_uris: ['https://evil.example/cb'] }) })
    ).toBeNull()
  })
})
