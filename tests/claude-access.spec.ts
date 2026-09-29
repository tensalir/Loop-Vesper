import { test, expect } from '@playwright/test'
import {
  claudeAccessDomains,
  claudeAccessFor,
  decideClaudeAccess,
  emailDomain,
  ensureClaudeAccess,
  type AccessProfile,
  type ClaudeAccessStore,
  type DecisionRecord,
} from '../src/lib/oauth/claude-access'
import { checkAccess } from '../src/lib/oauth/tokens'
import type { CredentialState, TokenRecord } from '../src/lib/oauth/store'

/**
 * Claude access for Loop accounts on first connect: a confirmed email on a listed domain is
 * granted at the person's Allow, unless an admin has decided, and the admin's decision always
 * wins. Run over an in-memory store with the same conditional write as the Prisma one.
 */

const T0 = new Date('2026-10-01T09:00:00Z')
const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv
const LOOP_ENV = envOf({ CLAUDE_ACCESS_DOMAINS: 'loopearplugs.com' })

interface Row extends AccessProfile {
  mcpAccessDecidedBy: string | null
  mcpAccessAutoGrantedAt: Date | null
}

class MemoryAccessStore implements ClaudeAccessStore {
  rows = new Map<string, Row>()
  writes = 0
  /** Runs between the read and the conditional write, to stage a race. */
  beforeGrant: (() => void) | null = null

  add(over: Partial<Row> & { id: string }): Row {
    const row: Row = {
      role: 'user',
      mcpAccess: false,
      pausedAt: null,
      deletedAt: null,
      mcpAccessDecidedAt: null,
      mcpAccessDecidedBy: null,
      mcpAccessAutoGrantedAt: null,
      ...over,
    }
    this.rows.set(row.id, row)
    return row
  }

  async findProfile(id: string) {
    const r = this.rows.get(id)
    if (!r) return null
    return { id: r.id, role: r.role, mcpAccess: r.mcpAccess, pausedAt: r.pausedAt, deletedAt: r.deletedAt, mcpAccessDecidedAt: r.mcpAccessDecidedAt }
  }

  async grantAutomatically(id: string, now: Date) {
    this.beforeGrant?.()
    const r = this.rows.get(id)
    // The same conditions as the Prisma store's updateMany.
    if (!r || r.mcpAccess || r.mcpAccessDecidedAt || r.pausedAt || r.deletedAt) return false
    r.mcpAccess = true
    r.mcpAccessAutoGrantedAt = now
    this.writes++
    return true
  }

  async recordDecision(id: string, data: { mcpAccess: boolean; mcpAccessDecidedAt: Date; mcpAccessDecidedBy: string }): Promise<DecisionRecord> {
    const r = this.rows.get(id)!
    Object.assign(r, data)
    this.writes++
    return { id: r.id, mcpAccess: r.mcpAccess, mcpAccessDecidedAt: r.mcpAccessDecidedAt, mcpAccessDecidedBy: r.mcpAccessDecidedBy, mcpAccessAutoGrantedAt: r.mcpAccessAutoGrantedAt }
  }
}

// What Supabase's getUser() returns for a Google sign-in: Google verified the address.
function googleUser(id: string, email: string, confirmed = true) {
  return {
    id,
    email,
    email_confirmed_at: confirmed ? '2026-09-30T08:00:00Z' : null,
    app_metadata: { provider: 'google', providers: ['google'] },
  }
}

function setup(over: Partial<Row> = {}) {
  const store = new MemoryAccessStore()
  const row = store.add({ id: 'person-1', ...over })
  const logs: string[] = []
  const ensure = (user: ReturnType<typeof googleUser>) =>
    ensureClaudeAccess(user, { store, env: LOOP_ENV, now: T0, log: (line) => logs.push(line) })
  return { store, row, logs, ensure }
}

test.describe('automatic Claude access', () => {
  test('a confirmed Loop Google account is granted at its Allow, once, and logged without the email', async () => {
    const { store, row, logs, ensure } = setup()
    const user = googleUser('person-1', 'Test.Person@LoopEarplugs.com')

    expect(claudeAccessFor(await store.findProfile('person-1'), user, LOOP_ENV)).toEqual({ state: 'grantable', domain: 'loopearplugs.com' })
    const first = await ensure(user)
    expect(first).toMatchObject({ allowed: true, granted: true })
    expect(row.mcpAccess).toBe(true)
    expect(row.mcpAccessAutoGrantedAt).toEqual(T0)
    expect(row.mcpAccessDecidedAt).toBeNull()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('person-1')
    expect(logs[0].toLowerCase()).not.toContain('test.person')

    // The next connect finds access on and writes nothing.
    const again = await ensure(user)
    expect(again).toMatchObject({ allowed: true, granted: false })
    expect(store.writes).toBe(1)
    expect(logs).toHaveLength(1)
  })

  test('the token check on every request passes once granted', async () => {
    const { store, row, ensure } = setup()
    await ensure(googleUser('person-1', 'test.person@loopearplugs.com'))
    const token: TokenRecord = {
      id: 't',
      credentialId: 'c',
      kind: 'access',
      tokenHash: 'h',
      familyId: 'f',
      parentId: null,
      codeId: null,
      clientId: 'client',
      scope: 'vesper',
      resource: 'https://v.example/api/mcp',
      familyExpiresAt: new Date(T0.getTime() + 86_400_000),
      expiresAt: new Date(T0.getTime() + 3600_000),
      usedAt: null,
      revokedAt: null,
    }
    const credential: CredentialState = { id: 'c', ownerId: 'person-1', kind: 'oauth', revokedAt: null }
    const owner = { id: row.id, role: row.role, pausedAt: null, deletedAt: null, mcpAccess: row.mcpAccess }
    expect(checkAccess({ token, credential, owner }, { now: T0, resources: ['https://v.example/api/mcp'] })).toEqual({ ok: true })

    // An admin turning it off afterwards: the next request is refused, and connecting again does not undo it.
    await decideClaudeAccess(store, { profileId: 'person-1', enabled: false, adminId: 'admin-1', now: T0 })
    const off = checkAccess({ token, credential, owner: { ...owner, mcpAccess: row.mcpAccess } }, { now: T0, resources: ['https://v.example/api/mcp'] })
    expect(off.ok === false && off.status === 403).toBe(true)
    expect(await ensure(googleUser('person-1', 'test.person@loopearplugs.com'))).toMatchObject({ allowed: false })
    expect(row.mcpAccess).toBe(false)
  })

  test('another domain, a look-alike domain or a subdomain is refused and nothing is written', async () => {
    for (const email of ['test.person@gmail.com', 'test.person@notloopearplugs.com', 'test.person@mail.loopearplugs.com', 'loopearplugs.com@evil.example', 'no-at-sign']) {
      const { store, row, ensure } = setup()
      const res = await ensure(googleUser('person-1', email))
      expect(res, email).toMatchObject({ allowed: false, granted: false, access: { state: 'refused', reason: 'domain' } })
      expect(row.mcpAccess).toBe(false)
      expect(store.writes).toBe(0)
    }
  })

  test('an unconfirmed Loop email is refused', async () => {
    const { store, row, ensure } = setup()
    const res = await ensure(googleUser('person-1', 'test.person@loopearplugs.com', false))
    expect(res).toMatchObject({ allowed: false, access: { state: 'refused', reason: 'email_unconfirmed' } })
    expect(row.mcpAccess).toBe(false)
    expect(store.writes).toBe(0)
  })

  test('a paused or deleted profile is refused, and so is a person with no profile', async () => {
    for (const [over, reason] of [
      [{ pausedAt: T0 }, 'paused'],
      [{ deletedAt: T0 }, 'deleted'],
    ] as Array<[Partial<Row>, string]>) {
      const { store, row, ensure } = setup(over)
      const res = await ensure(googleUser('person-1', 'test.person@loopearplugs.com'))
      expect(res).toMatchObject({ allowed: false, access: { state: 'refused', reason } })
      expect(row.mcpAccess).toBe(false)
      expect(store.writes).toBe(0)
    }
    const { ensure } = setup()
    expect(await ensure(googleUser('someone-else', 'x@loopearplugs.com'))).toMatchObject({ allowed: false, access: { reason: 'no_profile' } })
  })

  test('a Loop profile an admin turned off stays off; one an admin turned on passes', async () => {
    const off = setup({ mcpAccess: false, mcpAccessDecidedAt: T0, mcpAccessDecidedBy: 'admin-1' })
    expect(await off.ensure(googleUser('person-1', 'test.person@loopearplugs.com'))).toMatchObject({
      allowed: false,
      access: { state: 'refused', reason: 'admin_decided' },
    })
    expect(off.row.mcpAccess).toBe(false)
    expect(off.store.writes).toBe(0)

    const on = setup({ mcpAccess: true, mcpAccessDecidedAt: T0, mcpAccessDecidedBy: 'admin-1' })
    expect(await on.ensure(googleUser('person-1', 'test.person@gmail.com'))).toMatchObject({ allowed: true, granted: false })
    expect(on.row.mcpAccessAutoGrantedAt).toBeNull()
  })

  test('an admin passes without the flag, whatever their domain', async () => {
    const { store, ensure } = setup({ role: 'admin' })
    expect(await ensure(googleUser('person-1', 'boss@elsewhere.example', false))).toMatchObject({ allowed: true, granted: false })
    expect(store.writes).toBe(0)
  })

  test('an admin deciding at the same moment wins the race', async () => {
    const { store, row, logs, ensure } = setup()
    store.beforeGrant = () => {
      row.mcpAccessDecidedAt = T0
      row.mcpAccessDecidedBy = 'admin-1'
    }
    const res = await ensure(googleUser('person-1', 'test.person@loopearplugs.com'))
    expect(res).toMatchObject({ allowed: false, granted: false, access: { reason: 'admin_decided' } })
    expect(row.mcpAccess).toBe(false)
    expect(logs).toHaveLength(0)
  })
})

test.describe('the admin switch', () => {
  test('records the decision with who made it and when, on and off', async () => {
    const store = new MemoryAccessStore()
    store.add({ id: 'person-1', mcpAccess: true, mcpAccessAutoGrantedAt: T0 })
    const later = new Date(T0.getTime() + 60_000)

    const off = await decideClaudeAccess(store, { profileId: 'person-1', enabled: false, adminId: 'admin-1', now: later })
    expect(off).toEqual({
      ok: true,
      profile: { id: 'person-1', mcpAccess: false, mcpAccessDecidedAt: later, mcpAccessDecidedBy: 'admin-1', mcpAccessAutoGrantedAt: T0 },
    })

    const on = await decideClaudeAccess(store, { profileId: 'person-1', enabled: true, adminId: 'admin-2', now: later })
    expect(on.ok && on.profile).toMatchObject({ mcpAccess: true, mcpAccessDecidedBy: 'admin-2' })
  })

  test('keeping a Loop account off before it ever connects blocks the automatic grant', async () => {
    const store = new MemoryAccessStore()
    const row = store.add({ id: 'person-1' })
    await decideClaudeAccess(store, { profileId: 'person-1', enabled: false, adminId: 'admin-1', now: T0 })
    const res = await ensureClaudeAccess(googleUser('person-1', 'test.person@loopearplugs.com'), { store, env: LOOP_ENV, now: T0, log: () => undefined })
    expect(res.allowed).toBe(false)
    expect(row.mcpAccess).toBe(false)
  })

  test('an unknown profile is a 404 and a deleted one a 400, with nothing written', async () => {
    const store = new MemoryAccessStore()
    store.add({ id: 'gone', deletedAt: T0 })
    expect(await decideClaudeAccess(store, { profileId: 'nobody', enabled: true, adminId: 'a', now: T0 })).toMatchObject({ ok: false, status: 404 })
    expect(await decideClaudeAccess(store, { profileId: 'gone', enabled: true, adminId: 'a', now: T0 })).toMatchObject({ ok: false, status: 400 })
    expect(store.writes).toBe(0)
  })
})

test.describe('CLAUDE_ACCESS_DOMAINS', () => {
  test('defaults to loopearplugs.com; comma-separated, trimmed, case-insensitive, a leading @ tolerated', () => {
    expect(claudeAccessDomains({} as NodeJS.ProcessEnv)).toEqual(['loopearplugs.com'])
    expect(claudeAccessDomains(envOf({ CLAUDE_ACCESS_DOMAINS: ' LoopEarplugs.com, @partner.example ,' }))).toEqual([
      'loopearplugs.com',
      'partner.example',
    ])
  })

  test('empty turns the automatic grant off', async () => {
    expect(claudeAccessDomains(envOf({ CLAUDE_ACCESS_DOMAINS: '' }))).toEqual([])
    const store = new MemoryAccessStore()
    store.add({ id: 'person-1' })
    const res = await ensureClaudeAccess(googleUser('person-1', 'test.person@loopearplugs.com'), {
      store,
      env: envOf({ CLAUDE_ACCESS_DOMAINS: '' }),
      now: T0,
    })
    expect(res).toMatchObject({ allowed: false, access: { reason: 'domain' } })
  })

  test('the domain is the part after the last @', () => {
    expect(emailDomain('a@b@Loopearplugs.com')).toBe('loopearplugs.com')
    expect(emailDomain('@loopearplugs.com')).toBeNull()
    expect(emailDomain('test.person@')).toBeNull()
    expect(emailDomain(null)).toBeNull()
  })
})
