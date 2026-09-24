/**
 * The OAuth discovery documents (RFC 9728, RFC 8414) and the 401 challenge.
 *
 * The issuer is the site's origin and the documents sit at the root of the
 * site, where the standards fix them, not under `/api`. The protected resource
 * is `<origin>/api/mcp`. Every URL is derived from the origin of the request,
 * so a preview deployment describes itself.
 */

import { SCOPES_SUPPORTED, type OAuthConfig } from './config'

function clean(origin: string): string {
  return origin.replace(/\/$/, '')
}

export function issuerFor(origin: string): string {
  return clean(origin)
}

export function resourceUrl(origin: string): string {
  return `${clean(origin)}/api/mcp`
}

export function resourceMetadataUrl(origin: string): string {
  return `${clean(origin)}/.well-known/oauth-protected-resource/api/mcp`
}

/** The resources this server answers to: its own and the configured aliases. */
export function acceptedResources(origin: string, cfg: Pick<OAuthConfig, 'resourceAliases'>): string[] {
  return [resourceUrl(origin), ...cfg.resourceAliases]
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    resource_name: 'Vesper',
    authorization_servers: [issuerFor(origin)],
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ['header'],
    resource_documentation: `${clean(origin)}/headless`,
  }
}

export function authorizationServerMetadata(origin: string, cfg: Pick<OAuthConfig, 'cimd'>) {
  const base = clean(origin)
  const authMethods = ['none', 'client_secret_post', 'client_secret_basic']
  return {
    issuer: issuerFor(origin),
    authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/register`,
    revocation_endpoint: `${base}/api/mcp/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: authMethods,
    revocation_endpoint_auth_methods_supported: authMethods,
    scopes_supported: [...SCOPES_SUPPORTED],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: cfg.cimd,
    service_documentation: `${base}/headless`,
  }
}

/**
 * The `WWW-Authenticate` value of a 401 from `/api/mcp`, pointing the client at
 * the protected-resource document (RFC 9728 §5.1). `invalid` says a token was
 * sent and refused, which tells the client to refresh or sign in again.
 */
export function challengeHeader(origin: string, invalid?: string): string {
  const parts = [
    'Bearer realm="vesper"',
    `resource_metadata="${resourceMetadataUrl(origin)}"`,
    'scope="mcp:tools"',
  ]
  if (invalid) {
    parts.push('error="invalid_token"')
    parts.push(`error_description="${invalid.replace(/["\\]/g, '')}"`)
  }
  return parts.join(', ')
}

/** Discovery and token endpoints are called by browser-based clients (the MCP Inspector); no cookies are involved. */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '600',
}
