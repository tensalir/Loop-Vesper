import { test, expect } from '@playwright/test'
import { composeAnchoredPrompt, readAnchor, resolveLineageAnchor } from '../src/lib/generation/anchor'

/**
 * Iterating on a draw anchored on a product render re-attaches the render,
 * not the draw. Web generations without an anchor in their lineage are unchanged.
 */

const anchor = { kind: 'product-render', url: 'https://abcd.supabase.co/render.png', id: 'r1', sha256: 'ab' }

test('readAnchor accepts a well-formed anchor and refuses anything else', () => {
  expect(readAnchor({ anchor })?.id).toBe('r1')
  expect(readAnchor({ anchor: { ...anchor, url: 'http://x/y.png' } })).toBeNull()
  expect(readAnchor({ anchor: { ...anchor, kind: 'draw' } })).toBeNull()
  expect(readAnchor({})).toBeNull()
  expect(readAnchor(null)).toBeNull()
})

test('walks the lineage to the anchored draw and carries its prompt', async () => {
  // out-C came from gen C (a web iteration of out-B), out-B from gen B (a web iteration of out-A),
  // out-A from gen A, the MCP draw with the anchor.
  const gens: Record<string, { prompt: string; parameters: unknown }> = {
    'out-A': { prompt: 'SKELETON PROMPT', parameters: { anchor } },
    'out-B': { prompt: 'warmer light', parameters: { sourceRootOutputId: 'out-A', sourceKind: 'edited' } },
  }
  const lookup = { generationForOutput: async (id: string) => gens[id] ?? null }
  const resolved = await resolveLineageAnchor({ sourceRootOutputId: 'out-B' }, lookup)
  expect(resolved?.anchor.id).toBe('r1')
  expect(resolved?.anchorPrompt).toBe('SKELETON PROMPT')
})

test('an iteration that already carries anchorPrompt keeps the original prompt', async () => {
  const lookup = {
    generationForOutput: async () => ({
      prompt: 'SKELETON PROMPT\n\nApply this one change: warmer light',
      parameters: { anchor, anchorPrompt: 'SKELETON PROMPT' },
    }),
  }
  const resolved = await resolveLineageAnchor({ sourceRootOutputId: 'out-B' }, lookup)
  expect(resolved?.anchorPrompt).toBe('SKELETON PROMPT')
})

test('no anchor in the lineage, or a loop, returns null', async () => {
  const plain = { generationForOutput: async () => ({ prompt: 'p', parameters: {} }) }
  expect(await resolveLineageAnchor({ sourceRootOutputId: 'x' }, plain)).toBeNull()
  const loop = {
    generationForOutput: async (id: string) => ({ prompt: 'p', parameters: { sourceRootOutputId: id } }),
  }
  expect(await resolveLineageAnchor({ sourceRootOutputId: 'x' }, loop)).toBeNull()
  expect(await resolveLineageAnchor({}, plain)).toBeNull()
})

test('composeAnchoredPrompt: the anchored prompt, then the one change', () => {
  expect(composeAnchoredPrompt('BASE', 'warmer light')).toBe('BASE\n\nApply this one change: warmer light')
  expect(composeAnchoredPrompt('BASE', 'BASE plus more')).toBe('BASE plus more')
  expect(composeAnchoredPrompt('', 'only edit')).toBe('only edit')
})
