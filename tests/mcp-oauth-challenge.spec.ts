import { test, expect } from '@playwright/test'
import { verifyHeadlessRequest } from '../src/lib/headless/auth'

/**
 * The 401 that starts a sign-in: only the bare /api/mcp sends the challenge,
 * and only while the sign-in is on. These paths return before any database
 * read, so they run without one.
 */

const ORIGIN = 'https://vesper.example'
const SECRET = 'c'.repeat(48)

function post(headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/mcp`, { method: 'POST', headers })
}

test.describe('the 401 challenge', () => {
  test.beforeEach(() => {
    process.env.MCP_OAUTH_SECRET = SECRET
    delete process.env.MCP_OAUTH_ENABLED
  })
  test.afterEach(() => {
    delete process.env.MCP_OAUTH_SECRET
    delete process.env.MCP_OAUTH_ENABLED
  })

  test('a tokenless request to the bare route gets WWW-Authenticate with the resource metadata', async () => {
    const res = await verifyHeadlessRequest(post(), { surface: 'mcp', challenge: { origin: ORIGIN } })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.response.status).toBe(401)
    const header = res.response.headers.get('www-authenticate') || ''
    expect(header).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)
    expect(header).not.toContain('invalid_token')
  })

  test('the token-in-URL route and REST never send it', async () => {
    const res = await verifyHeadlessRequest(post(), { surface: 'mcp' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.headers.get('www-authenticate')).toBeNull()
    const rest = await verifyHeadlessRequest(post(), { surface: 'rest' })
    if (!rest.ok) expect(rest.response.headers.get('www-authenticate')).toBeNull()
  })

  test('switched off, no challenge: static tokens are the only way in', async () => {
    process.env.MCP_OAUTH_ENABLED = '0'
    const res = await verifyHeadlessRequest(post(), { surface: 'mcp', challenge: { origin: ORIGIN } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.headers.get('www-authenticate')).toBeNull()
  })

  test('a sign-in token in the URL, or on REST, is refused before any lookup', async () => {
    const token = `vsp_oat_${'A'.repeat(43)}`
    const inPath = await verifyHeadlessRequest(post(), { surface: 'mcp', tokenFromPath: token })
    expect(inPath.ok).toBe(false)
    if (!inPath.ok) expect(inPath.response.status).toBe(401)
    const rest = await verifyHeadlessRequest(post({ authorization: `Bearer ${token}` }), { surface: 'rest' })
    expect(rest.ok).toBe(false)
    if (!rest.ok) expect(rest.response.status).toBe(401)
  })
})
