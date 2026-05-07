import { test, expect } from '@playwright/test'
import { roleAllows, type CmfPacketRole } from '../src/lib/cmf/service'

/**
 * Pin the role hierarchy. owner > approver > editor > viewer. Used by
 * route handlers to gate write actions; if this matrix changes silently
 * we'd weaken auth without noticing.
 */

const ROLES: CmfPacketRole[] = ['viewer', 'editor', 'approver', 'owner']

test('roleAllows is reflexive — every role allows itself', () => {
  for (const role of ROLES) {
    expect(roleAllows(role, role)).toBe(true)
  }
})

test('roleAllows is monotonic — higher roles allow lower-required actions', () => {
  expect(roleAllows('owner', 'viewer')).toBe(true)
  expect(roleAllows('owner', 'editor')).toBe(true)
  expect(roleAllows('owner', 'approver')).toBe(true)
  expect(roleAllows('approver', 'editor')).toBe(true)
  expect(roleAllows('approver', 'viewer')).toBe(true)
  expect(roleAllows('editor', 'viewer')).toBe(true)
})

test('roleAllows blocks lower roles from privileged actions', () => {
  expect(roleAllows('viewer', 'editor')).toBe(false)
  expect(roleAllows('viewer', 'approver')).toBe(false)
  expect(roleAllows('viewer', 'owner')).toBe(false)
  expect(roleAllows('editor', 'approver')).toBe(false)
  expect(roleAllows('editor', 'owner')).toBe(false)
  expect(roleAllows('approver', 'owner')).toBe(false)
})
