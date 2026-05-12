import { test, expect } from '@playwright/test'
import {
  deriveEffectivePacketRole,
  profileCanWriteCmf,
  roleAllows,
} from '../src/lib/cmf/service'

/**
 * Access matrix for the global-library model (rolled out 2026-05-12).
 *
 * Posture under the new model:
 *   - READ: any authenticated profile can list and view every packet —
 *     the library is one ground truth.
 *   - WRITE: gated on `requireCmfWrite()`, which is a thin wrapper over
 *     `profileCanWriteCmf` (admin role OR `cmfAccess` flag). Per-packet
 *     `CmfPacketMember` rows are audit metadata only, not gating.
 *
 * This spec pins the boolean that decides who can mutate, plus the role
 * mapping returned by `deriveEffectivePacketRole`. If either flips
 * silently we'd weaken auth without noticing — the same kind of
 * regression `cmf-roles.spec.ts` defends against for the role hierarchy.
 */

test('viewer (no flag, not owner) is read-only', () => {
  const profile = { role: 'user', cmfAccess: false }
  expect(profileCanWriteCmf(profile)).toBe(false)
  const role = deriveEffectivePacketRole({
    packetOwnerId: 'someone-else',
    callerUserId: 'caller',
    callerProfile: profile,
  })
  expect(role).toBe('viewer')
  // viewer fails every write check the routes make.
  expect(roleAllows(role, 'editor')).toBe(false)
  expect(roleAllows(role, 'approver')).toBe(false)
  expect(roleAllows(role, 'owner')).toBe(false)
})

test('user with cmfAccess flag becomes editor', () => {
  const profile = { role: 'user', cmfAccess: true }
  expect(profileCanWriteCmf(profile)).toBe(true)
  const role = deriveEffectivePacketRole({
    packetOwnerId: 'someone-else',
    callerUserId: 'caller',
    callerProfile: profile,
  })
  expect(role).toBe('editor')
  expect(roleAllows(role, 'editor')).toBe(true)
  // editor is below approver/owner — those gates remain intact.
  expect(roleAllows(role, 'approver')).toBe(false)
  expect(roleAllows(role, 'owner')).toBe(false)
})

test('admin always wins regardless of cmfAccess', () => {
  for (const cmfAccess of [true, false, undefined, null]) {
    const profile = { role: 'admin', cmfAccess }
    expect(profileCanWriteCmf(profile)).toBe(true)
    const role = deriveEffectivePacketRole({
      packetOwnerId: 'someone-else',
      callerUserId: 'caller',
      callerProfile: profile,
    })
    expect(role).toBe('editor')
  }
})

test('owner of a packet keeps the owner badge regardless of flags', () => {
  // Even a viewer-style profile gets `owner` when the packet is theirs —
  // that's how the activity drawer continues to attribute history to the
  // person who imported the workbook in the first place.
  const profile = { role: 'user', cmfAccess: false }
  const role = deriveEffectivePacketRole({
    packetOwnerId: 'caller',
    callerUserId: 'caller',
    callerProfile: profile,
  })
  expect(role).toBe('owner')
  // owner is the apex — passes every minRole check.
  expect(roleAllows(role, 'editor')).toBe(true)
  expect(roleAllows(role, 'approver')).toBe(true)
  expect(roleAllows(role, 'owner')).toBe(true)
})

test('missing profile is treated as viewer (defensive default)', () => {
  expect(profileCanWriteCmf(null)).toBe(false)
  expect(profileCanWriteCmf(undefined)).toBe(false)
  const role = deriveEffectivePacketRole({
    packetOwnerId: 'someone-else',
    callerUserId: 'caller',
    callerProfile: null,
  })
  expect(role).toBe('viewer')
})

test('cmfAccess only counts when literally true (no truthy coercion)', () => {
  // Guard against accidentally treating string "true" / 1 / "yes" as
  // grants — the column is BOOLEAN in Postgres, but a stray casting
  // bug in the API layer shouldn't open writes to anyone.
  expect(profileCanWriteCmf({ role: 'user', cmfAccess: false })).toBe(false)
  // The helper signature only accepts boolean | null | undefined, but we
  // verify the runtime guard explicitly for types that might slip
  // through Prisma deserialisation:
  const looselyTyped = { role: 'user', cmfAccess: 'true' } as unknown as {
    role: string
    cmfAccess: boolean
  }
  expect(profileCanWriteCmf(looselyTyped)).toBe(false)
})

test('owner check trumps the cmfAccess gate', () => {
  // A user who is BOTH the owner AND has cmfAccess is still labelled
  // 'owner', not 'editor' — the highest-trust label wins.
  const profile = { role: 'user', cmfAccess: true }
  const role = deriveEffectivePacketRole({
    packetOwnerId: 'caller',
    callerUserId: 'caller',
    callerProfile: profile,
  })
  expect(role).toBe('owner')
})
