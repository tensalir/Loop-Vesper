import { test, expect } from '@playwright/test'
import { oauthConfig } from '../src/lib/oauth/config'
import {
  authorizationServerMetadata,
  challengeHeader,
  protectedResourceMetadata,
  resourceMetadataUrl,
  resourceUrl,
} from '../src/lib/oauth/metadata'
import { shouldSkipAuth, isPublicRoute } from '../src/lib/auth/route-rules'
import { safeNext } from '../src/lib/auth/next-param'
import { extractBearerToken } from '../src/lib/headless/tokens'

/**
 * Discovery: what a client reads before it signs in, and the 401 that sends
 * it there. The issuer is the origin; the resource is `<origin>/api/mcp`.
 */

const ORIGIN = 'https://vesper.example'

test.describe('the discovery documents', () => {
  test('protected-resource metadata names this site as the authorization server', () => {
    const doc = protectedResourceMetadata(ORIGIN)
    expect(doc.resource).toBe('https://vesper.example/api/mcp')
    expect(doc.authorization_servers).toEqual(['https://vesper.example'])
    expect(doc.bearer_methods_supported).toEqual(['header'])
    expect(doc.scopes_supported).toContain('mcp:tools')
  })

  test('authorization-server metadata: issuer without a path, S256 only, both client kinds', () => {
    const doc = authorizationServerMetadata(`${ORIGIN}/`, { cimd: false })
    expect(doc.issuer).toBe(ORIGIN)
    expect(new URL(doc.issuer).pathname).toBe('/')
    expect(doc.authorization_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/authorize`)
    expect(doc.token_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/token`)
    expect(doc.registration_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/register`)
    expect(doc.revocation_endpoint).toBe(`${ORIGIN}/api/mcp/oauth/revoke`)
    expect(doc.code_challenge_methods_supported).toEqual(['S256'])
    expect(doc.grant_types_supported).toEqual(['authorization_code', 'refresh_token'])
    expect(doc.token_endpoint_auth_methods_supported).toEqual(['none', 'client_secret_post', 'client_secret_basic'])
    expect(doc.authorization_response_iss_parameter_supported).toBe(true)
    expect(doc.client_id_metadata_document_supported).toBe(false)
  })

  test('the challenge points at the path-suffixed resource document', () => {
    expect(resourceUrl(ORIGIN)).toBe(`${ORIGIN}/api/mcp`)
    expect(resourceMetadataUrl(ORIGIN)).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)
    const bare = challengeHeader(ORIGIN)
    expect(bare).toBe(
      `Bearer realm="vesper", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="mcp:tools"`
    )
    expect(bare).not.toContain('error=')
    const invalid = challengeHeader(ORIGIN, 'The access token "expired".')
    expect(invalid).toContain('error="invalid_token"')
    expect(invalid).toContain('error_description="The access token expired."')
  })

  test('the sign-in is off without a long secret, and when switched off', () => {
    expect(oauthConfig({} as unknown as NodeJS.ProcessEnv).enabled).toBe(false)
    expect(oauthConfig({ MCP_OAUTH_SECRET: 'short' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false)
    const secret = 'x'.repeat(40)
    expect(oauthConfig({ MCP_OAUTH_SECRET: secret } as unknown as NodeJS.ProcessEnv).enabled).toBe(true)
    expect(oauthConfig({ MCP_OAUTH_SECRET: secret, MCP_OAUTH_ENABLED: '0' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false)
    const cfg = oauthConfig({
      MCP_OAUTH_SECRET: secret,
      MCP_RESOURCE_ALIASES: 'https://other.example/api/mcp/, https://third.example/api/mcp',
      MCP_OAUTH_REDIRECT_ALLOWLIST: 'https://app.example/cb',
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg.resourceAliases).toEqual(['https://other.example/api/mcp', 'https://third.example/api/mcp'])
    expect(cfg.redirectAllowlist).toEqual(['https://app.example/cb'])
  })
})

test.describe('the middleware and the login redirect', () => {
  test('the discovery documents skip the middleware, the consent page does not', () => {
    expect(shouldSkipAuth('/.well-known/oauth-protected-resource/api/mcp')).toBe(true)
    expect(shouldSkipAuth('/.well-known/oauth-authorization-server')).toBe(true)
    expect(shouldSkipAuth('/api/mcp')).toBe(true)
    expect(shouldSkipAuth('/connect')).toBe(false)
    expect(isPublicRoute('/connect')).toBe(false)
    expect(isPublicRoute('/login')).toBe(true)
  })

  test('safeNext keeps a path on this site and refuses anything that leaves it', () => {
    expect(safeNext('/connect?areq=abc.def')).toBe('/connect?areq=abc.def')
    expect(safeNext('/projects/1#x')).toBe('/projects/1#x')
    for (const bad of [
      'https://evil.example/',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      '/ok\r\nSet-Cookie: x=1',
      'connect',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad as string | null | undefined)).toBe('/projects')
    }
    expect(safeNext('//evil', '')).toBe('')
  })
})

test.describe('the bearer token shapes', () => {
  test('a sign-in access token is read from the header; malformed ones are not', () => {
    const token = `vsp_oat_${'A'.repeat(43)}`
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
    expect(extractBearerToken(`Bearer vsp_oat_${'A'.repeat(42)}`)).toBeNull()
    expect(extractBearerToken(`Bearer vsp_oat_${'A'.repeat(42)}!`)).toBeNull()
    // A refresh token is never a bearer token.
    expect(extractBearerToken(`Bearer vsp_ort_${'A'.repeat(43)}`)).toBeNull()
  })
})
