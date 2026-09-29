/**
 * Who may connect Claude to Vesper, and the automatic grant for Loop accounts.
 *
 * Before this, `profiles.mcp_access` defaulted to false and an admin turned it on person by
 * person. Now a person whose Supabase account has a confirmed email on one of
 * `CLAUDE_ACCESS_DOMAINS` (comma-separated, default `loopearplugs.com`) gets it the first time
 * they connect Claude: /connect shows them the normal consent, and their Allow turns the flag on
 * (`ensureClaudeAccess`, called from /api/mcp/oauth/decision). The spend control is the daily
 * allowance in src/lib/headless/claude-allowance.ts, not the switch.
 *
 * An admin's decision always wins. The switch under Users records when and by whom
 * (`mcp_access_decided_at`, `mcp_access_decided_by`), and the automatic grant never touches a
 * profile with a decision recorded, so someone an admin turned off stays off. Paused and deleted
 * profiles, other domains and unconfirmed emails are refused as before.
 *
 * The domain is the part after the last '@', compared exactly: `loopearplugs.com` does not admit
 * `mail.loopearplugs.com` or `notloopearplugs.com` unless those are listed too. An empty
 * `CLAUDE_ACCESS_DOMAINS` turns the automatic grant off.
 */

import { prisma } from '@/lib/prisma'

export const DEFAULT_CLAUDE_ACCESS_DOMAINS = ['loopearplugs.com']

/** The profile fields the decision reads. */
export interface AccessProfile {
  id: string
  role: string
  mcpAccess: boolean
  pausedAt: Date | null
  deletedAt: Date | null
  mcpAccessDecidedAt: Date | null
}

/** The Supabase auth user fields the decision reads (`getUser()`, server-validated). */
export interface AccessUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

export type RefusalReason = 'no_profile' | 'deleted' | 'paused' | 'admin_decided' | 'email_unconfirmed' | 'domain'

export type ClaudeAccess =
  | { state: 'allowed' }
  | { state: 'grantable'; domain: string }
  | { state: 'refused'; reason: RefusalReason }

export function claudeAccessDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CLAUDE_ACCESS_DOMAINS
  if (raw === undefined) return [...DEFAULT_CLAUDE_ACCESS_DOMAINS]
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).trim().toLowerCase()
}

/** Whether this person may connect Claude now, may be granted it by connecting, or is refused. */
export function claudeAccessFor(
  profile: AccessProfile | null,
  user: AccessUser,
  env: NodeJS.ProcessEnv = process.env
): ClaudeAccess {
  if (!profile) return { state: 'refused', reason: 'no_profile' }
  if (profile.deletedAt) return { state: 'refused', reason: 'deleted' }
  if (profile.pausedAt) return { state: 'refused', reason: 'paused' }
  if (profile.role === 'admin' || profile.mcpAccess) return { state: 'allowed' }
  if (profile.mcpAccessDecidedAt) return { state: 'refused', reason: 'admin_decided' }
  if (!user.email_confirmed_at) return { state: 'refused', reason: 'email_unconfirmed' }
  const domain = emailDomain(user.email)
  if (!domain || !claudeAccessDomains(env).includes(domain)) return { state: 'refused', reason: 'domain' }
  return { state: 'grantable', domain }
}

/** What the admin switch writes: the flag and the decision, which automatic access then respects. */
export function adminDecisionData(input: { enabled: boolean; adminId: string; now: Date }) {
  return {
    mcpAccess: input.enabled,
    mcpAccessDecidedAt: input.now,
    mcpAccessDecidedBy: input.adminId,
  }
}

export interface DecisionRecord {
  id: string
  mcpAccess: boolean
  mcpAccessDecidedAt: Date | null
  mcpAccessDecidedBy: string | null
  mcpAccessAutoGrantedAt: Date | null
}

/** The reads and writes access needs; Prisma in production, in memory in the tests. */
export interface ClaudeAccessStore {
  findProfile(id: string): Promise<AccessProfile | null>
  /** Turn access on only while it is off, undecided and the profile active; true when this call did it. */
  grantAutomatically(id: string, now: Date): Promise<boolean>
  /** Write `adminDecisionData` to the profile and return what it holds afterwards. */
  recordDecision(id: string, data: ReturnType<typeof adminDecisionData>): Promise<DecisionRecord>
}

export interface EnsureResult {
  allowed: boolean
  /** True when this call turned access on. */
  granted: boolean
  access: ClaudeAccess
}

/**
 * At the person's Allow: grant Claude access when they qualify and nobody has decided otherwise.
 * The write is conditional, so an admin deciding at the same moment wins.
 */
export async function ensureClaudeAccess(
  user: AccessUser,
  deps: { store?: ClaudeAccessStore; env?: NodeJS.ProcessEnv; now?: Date; log?: (line: string) => void } = {}
): Promise<EnsureResult> {
  const store = deps.store ?? prismaClaudeAccessStore
  const env = deps.env ?? process.env
  const access = claudeAccessFor(await store.findProfile(user.id), user, env)
  if (access.state !== 'grantable') return { allowed: access.state === 'allowed', granted: false, access }

  if (await store.grantAutomatically(user.id, deps.now ?? new Date())) {
    // The access-change record: the profile id and the listed domain, never the address.
    const log = deps.log ?? console.info
    log(`[claude-access] granted automatically on first connect: profile ${user.id}, domain ${access.domain}`)
    return { allowed: true, granted: true, access }
  }
  // Lost a race (an admin decided, or another tab granted it first): answer from what is there now.
  const again = claudeAccessFor(await store.findProfile(user.id), user, env)
  return { allowed: again.state === 'allowed', granted: false, access: again }
}

export type DecideResult =
  | { ok: true; profile: DecisionRecord }
  | { ok: false; status: 400 | 404; error: string }

/** The admin switch: record the decision (on or off) with who made it and when. */
export async function decideClaudeAccess(
  store: ClaudeAccessStore,
  input: { profileId: string; enabled: boolean; adminId: string; now: Date }
): Promise<DecideResult> {
  const profile = await store.findProfile(input.profileId)
  if (!profile) return { ok: false, status: 404, error: 'User not found' }
  if (profile.deletedAt) return { ok: false, status: 400, error: 'Cannot grant access to a deleted user' }
  const updated = await store.recordDecision(
    input.profileId,
    adminDecisionData({ enabled: input.enabled, adminId: input.adminId, now: input.now })
  )
  return { ok: true, profile: updated }
}

const PROFILE_SELECT = {
  id: true,
  role: true,
  mcpAccess: true,
  pausedAt: true,
  deletedAt: true,
  mcpAccessDecidedAt: true,
} as const

export const prismaClaudeAccessStore: ClaudeAccessStore = {
  async findProfile(id) {
    return prisma.profile.findUnique({ where: { id }, select: PROFILE_SELECT })
  },
  async grantAutomatically(id, now) {
    const res = await prisma.profile.updateMany({
      where: { id, mcpAccess: false, mcpAccessDecidedAt: null, pausedAt: null, deletedAt: null },
      data: { mcpAccess: true, mcpAccessAutoGrantedAt: now },
    })
    return res.count === 1
  },
  async recordDecision(id, data) {
    return prisma.profile.update({
      where: { id },
      data,
      select: {
        id: true,
        mcpAccess: true,
        mcpAccessDecidedAt: true,
        mcpAccessDecidedBy: true,
        mcpAccessAutoGrantedAt: true,
      },
    })
  },
}
