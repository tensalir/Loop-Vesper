import { test, expect } from '@playwright/test'
import {
  CMF_PRODUCT_CATALOG,
  getCmfProduct,
  listCmfProducts,
  getComponentLabel,
} from '../src/lib/cmf/products'
import {
  clownStoragePath,
  importStoragePath,
  packetPdfStoragePath,
  renderStoragePath,
  safeFileSlug,
} from '../src/lib/cmf/storage'

/**
 * Catalog and storage contract tests. These pin the shape product designers
 * see in the workbook template and the storage paths that the CMF API
 * routes write to. If we ever change a slug or storage layout, these tests
 * should change with it — never silently.
 */

test('CMF catalog ships at least one product per category', () => {
  const categories = new Set(CMF_PRODUCT_CATALOG.map((p) => p.category))
  expect(categories.has('earplug')).toBe(true)
  expect(categories.has('case')).toBe(true)
})

test('every product has at least one component and a default model', () => {
  for (const product of listCmfProducts()) {
    expect(product.components.length).toBeGreaterThan(0)
    expect(product.defaultModelId).toBeTruthy()
    expect(product.promptDescriptor.length).toBeGreaterThan(20)
  }
})

test('getCmfProduct is case-insensitive', () => {
  expect(getCmfProduct('Switch2')?.slug).toBe('switch2')
  expect(getCmfProduct('SWITCH2')?.slug).toBe('switch2')
  expect(getCmfProduct('switch2')?.slug).toBe('switch2')
})

test('getCmfProduct returns null for unknown slugs', () => {
  expect(getCmfProduct('not_a_product')).toBeNull()
})

test('getComponentLabel falls back to the region key for unknown components', () => {
  expect(getComponentLabel('switch2', 'pom_ring')).toBe('POM ring')
  expect(getComponentLabel('switch2', 'unknown_region')).toBe('unknown_region')
})

test('per-user storage paths are owner-scoped and contain no path-traversal characters', () => {
  const owner = '00000000-0000-0000-0000-000000000001'
  const packet = '00000000-0000-0000-0000-000000000002'
  const render = '00000000-0000-0000-0000-000000000003'
  const importId = '00000000-0000-0000-0000-000000000004'

  const paths = [
    importStoragePath(owner, importId),
    renderStoragePath(owner, packet, render, 'png'),
    packetPdfStoragePath(owner, packet, 'CMF-001234revA_Switch2_CMF_Sage'),
  ]

  for (const p of paths) {
    expect(p.startsWith(`cmf/${owner}/`)).toBe(true)
    expect(p).not.toContain('..')
    expect(p).not.toContain('//')
  }
})

test('clown storage paths are global, keyed on (productSlug, variantSlug)', () => {
  expect(clownStoragePath('switch2', 'motorsport-615', 'png')).toBe(
    'cmf/clowns/switch2/motorsport-615.png'
  )
  expect(clownStoragePath('case-aphrodite', '7613-555', 'png')).toBe(
    'cmf/clowns/case-aphrodite/7613-555.png'
  )
  // Path-traversal protection is enforced at the API layer (slug regex);
  // this assertion documents the structural contract callers depend on.
  const p = clownStoragePath('switch2', 'default', 'png')
  expect(p.startsWith('cmf/clowns/')).toBe(true)
  expect(p).not.toContain('..')
  expect(p).not.toContain('//')
})

test('safeFileSlug strips path-traversal and special characters', () => {
  expect(safeFileSlug('CMF-001234revA / ../etc/passwd')).toBe(
    'CMF-001234revA_etc_passwd'
  )
  expect(safeFileSlug('normal_name')).toBe('normal_name')
  expect(safeFileSlug('CMF-001234revA_Switch2_CMF_Sage')).toBe(
    'CMF-001234revA_Switch2_CMF_Sage'
  )
  expect(safeFileSlug('  spaces  ')).toBe('spaces')
})
