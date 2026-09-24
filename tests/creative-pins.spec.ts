import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KitSchema } from '../src/lib/creative/kit-schema'
import {
  kitPins,
  pinHealth,
  sha256Hex,
  syncPins,
  usablePin,
  type PinRow,
  type PinSpec,
  type PinStore,
  type PinSyncDeps,
} from '../src/lib/creative/pins'
import { resolveProduct, servedProducts } from '../src/lib/creative/products'
import { listProducts, referencePlan, kitSection } from '../src/lib/creative/tool-views'
import { buildIterateSystemPrompt, ITERATION_SLATE_MODE } from '../src/lib/prompts/iteration-slate-mode'
import { effectiveTools, HEADLESS_TOOLS, TOOL_META } from '../src/lib/headless/tool-registry'

const kit = KitSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures', 'creative', 'kit.v1.sample.json'), 'utf8')))

function memoryPins(): PinStore & { rows: PinRow[] } {
  const rows: PinRow[] = []
  return {
    rows,
    async get(pinId, sha256) {
      return rows.find((r) => r.pinId === pinId && r.sha256 === sha256) ?? null
    },
    async upsert(row) {
      const i = rows.findIndex((r) => r.pinId === row.pinId && r.sha256 === row.sha256)
      if (i >= 0) rows[i] = { ...row }
      else rows.push({ ...row })
    },
    async list(product) {
      return rows.filter((r) => !product || r.product === product)
    },
  }
}

function deps(over: Partial<PinSyncDeps> = {}) {
  const put: string[] = []
  const uploads: string[] = []
  const store = memoryPins()
  const blobs = new Map<string, Buffer>()
  const d: PinSyncDeps = {
    store,
    fetchFrontifyOriginal: async () => null,
    fetchClown: async () => null,
    storage: {
      async put(path, bytes) {
        put.push(path)
        blobs.set(path, bytes)
      },
      async get(path) {
        return blobs.get(path) ?? null
      },
    },
    gemini: {
      async upload(_b, _m, name) {
        uploads.push(name)
        return { uri: `files/${uploads.length}`, expiresAt: new Date(Date.now() + 48 * 3600 * 1000) }
      },
    },
    makePreview: async () => Buffer.from('jpeg'),
    ...over,
  }
  return { d, put, uploads, store, blobs }
}

function spec(bytes: Buffer, over: Partial<PinSpec> = {}): PinSpec {
  return {
    product: 'eclipse',
    pinId: 'asset-1',
    source: 'frontify',
    title: 'Loop_Eclipse-Teal-Side_2',
    sha256: sha256Hex(bytes),
    bytes: bytes.length,
    width: 3072,
    height: 3072,
    derived: false,
    frontifyAssetId: 'asset-1',
    clown: null,
    localPath: null,
    ...over,
  }
}

test.describe('pins', () => {
  test('the kit names every pin once, with its sha256; the oversized one is marked derived', () => {
    const pins = kitPins(kit)
    const eclipse = pins.filter((p) => p.product === 'eclipse')
    expect(eclipse).toHaveLength(18)
    expect(eclipse.every((p) => /^[0-9a-f]{64}$/.test(p.sha256))).toBe(true)
    expect(eclipse.filter((p) => p.derived).map((p) => p.title)).toEqual(['Eyelash_Clearance'])
    const clowns = pins.filter((p) => p.product === 'cmf')
    expect(clowns.length).toBe(25)
    expect(clowns.every((p) => p.source === 'vesper-storage' && p.clown)).toBe(true)
    // Packaging's two Frontify pins carry no sha256 in this kit, so they are not pinnable yet.
    expect(pins.filter((p) => p.product === 'packaging' && p.source === 'upload').length).toBe(9)
  })

  test('a pin whose bytes are not the kit\'s is never stored, never sent, never used', async () => {
    const real = Buffer.from('the real picture')
    const { d, put, uploads, store } = deps({ fetchFrontifyOriginal: async () => ({ bytes: Buffer.from('another picture'), contentType: 'image/png' }) })
    const [r] = await syncPins([spec(real)], d)
    expect(r.status).toBe('sha_mismatch')
    expect(put).toEqual([])
    expect(uploads).toEqual([])
    const row = store.rows[0]
    expect(row.status).toBe('sha_mismatch')
    expect(usablePin(row, spec(real))).toBe(false)
  })

  test('the right bytes are stored unchanged, previewed, uploaded once, and then left alone', async () => {
    const real = Buffer.from('the real picture')
    const { d, put, uploads, store, blobs } = deps({ fetchFrontifyOriginal: async () => ({ bytes: real, contentType: 'image/png' }) })
    const [r] = await syncPins([spec(real)], d)
    expect(r.status).toBe('ok')
    expect(put).toEqual([`pins/${sha256Hex(real)}.png`, `previews/${sha256Hex(real)}.jpg`])
    expect(blobs.get(`pins/${sha256Hex(real)}.png`)).toEqual(real)
    expect(uploads).toHaveLength(1)
    expect(usablePin(store.rows[0], spec(real))).toBe(true)
    const [again] = await syncPins([spec(real)], d)
    expect(again.note).toBe('current')
    expect(uploads).toHaveLength(1)
  })

  test('an upload pin waits for the admin script; an oversized pin waits for its derived copy', async () => {
    const real = Buffer.from('packaging render')
    const a = deps()
    const [up] = await syncPins([spec(real, { source: 'upload', frontifyAssetId: null })], a.d)
    expect(up.status).toBe('needs_upload')
    const b = deps({ fetchFrontifyOriginal: async () => ({ bytes: real, contentType: 'image/png' }) })
    const big = spec(real, { derived: true })
    const [first] = await syncPins([big], b.d)
    expect(first.status).toBe('needs_derived')
    expect(b.uploads).toEqual([])
    expect(usablePin(b.store.rows[0], big)).toBe(false)
    // The admin script stores the derived copy and names it on the row.
    b.blobs.set('pins/x@4096.png', Buffer.from('derived'))
    b.store.rows[0].derivedPath = 'pins/x@4096.png'
    b.store.rows[0].status = 'pending'
    const [second] = await syncPins([big], b.d)
    expect(second.status).toBe('ok')
    expect(b.uploads).toHaveLength(1)
    expect(usablePin(b.store.rows[0], big)).toBe(true)
  })

  test('health names each pin with its state', () => {
    const pins = kitPins(kit).filter((p) => p.product === 'eclipse')
    const health = pinHealth(pins, [])
    expect(health).toHaveLength(18)
    expect(health.every((h) => h.status === 'pending' && !h.usable)).toBe(true)
  })
})

test.describe('products and references', () => {
  test('a product is found by slug, name or alias; the list names only pilot and live', () => {
    expect(resolveProduct(kit, 'the sleep mask').slug).toBe('eclipse')
    expect(resolveProduct(kit, 'Coachella box').slug).toBe('packaging')
    expect(resolveProduct(kit, 'CMF sheet').slug).toBe('cmf')
    expect(() => resolveProduct(kit, 'Loop Dream')).toThrow("No Loop product called 'Loop Dream'")
    expect(servedProducts(kit).map((p) => p.slug).sort()).toEqual(['cmf', 'eclipse', 'packaging'])
    const scaffold = { ...kit, products: { ...kit.products, eclipse: { ...kit.products.eclipse, status: 'scaffold' as const } } }
    expect(() => resolveProduct(scaffold, 'eclipse')).toThrow('scaffold')
    expect(resolveProduct(scaffold, 'eclipse', { isAdmin: true }).slug).toBe('eclipse')
  })

  test('a draw attaches the product render first; a grade attaches the grader\'s references', () => {
    const gen = referencePlan(kit, { product: 'eclipse', purpose: 'generate', colourway: 'teal', view: 'profile' }, [])
    expect(gen.key).toEqual({ colourway: 'Teal', view: 'profile' })
    expect(gen.references[0].roles).toContain('render')
    expect(gen.references[0].title).toBe('Loop_Eclipse-Teal-Side_2')
    expect(gen.references.every((r) => !r.usable)).toBe(true) // nothing pinned yet
    expect(gen.missing.length).toBe(gen.references.length)
    const grade = referencePlan(kit, { product: 'eclipse', purpose: 'grade' }, [])
    expect(grade.assumed.join()).toContain('colourway Black')
    expect(grade.references.map((r) => r.pin_id)).toEqual(kit.products.eclipse.references!.attach.Black.frontal)
    const cmf = referencePlan(kit, { product: 'cmf', purpose: 'grade', clown: 'case-experience2--front' }, [])
    expect(cmf.references.map((r) => r.pin_id)).toEqual(['case-experience2--front'])
    const box = referencePlan(kit, { product: 'packaging', purpose: 'grade', look: 'coachella', scene: 'closed' }, [])
    expect(box.references[0].pin_id).toBe('white-closed')
    // every packaging reference is a pin with a sha256 since the plugin's kit fix (3461873): what is
    // missing here is only what has not been synced into creative-pins yet
    expect(box.missing.length).toBeGreaterThan(0)
    expect(box.missing.every((m) => m.includes('not pinned yet'))).toBe(true)
  })

  test('the product list names only tools the caller can call', () => {
    const products = listProducts(kit, (t) => t === 'get_product_references')
    expect(products.find((p) => p.slug === 'eclipse')?.tools).toEqual(['get_product_references'])
    expect(products.find((p) => p.slug === 'cmf')?.reporting_only).toBe(true)
  })

  test('the rubric section is the checks with their plain words', () => {
    const loaded = { kit, conformance: null as never, ref: 'creative-v0.2.0', commit: 'abc1234', blobSha: 'b', fetchedAt: new Date(), stale: false, staleReason: null }
    const { text, structured } = kitSection(loaded, 'rubric:eclipse', () => true)
    expect(text).toContain('| A1 | gate |')
    expect(structured.kit_version).toBe('0.2.0')
    expect(() => kitSection(loaded, 'secrets', () => true)).toThrow('Unknown section')
  })
})

test.describe('the creative tools in the registry', () => {
  test('they are OAuth tools, off the org token, and hidden when switched off', () => {
    const creative = HEADLESS_TOOLS.filter((t) => TOOL_META[t].group === 'creative')
    expect(creative).toEqual(['get_creative_kit', 'list_creative_products', 'get_product_references'])
    expect(creative.every((t) => TOOL_META[t].oauth && !TOOL_META[t].org)).toBe(true)
    const on = effectiveTools({ allowedTools: ['*'] }, { role: 'user' }, {} as NodeJS.ProcessEnv)
    expect(on).toEqual(expect.arrayContaining(creative))
    const off = effectiveTools({ allowedTools: ['*'] }, { role: 'user' }, { CREATIVE_TOOLS_ENABLED: '0' } as unknown as NodeJS.ProcessEnv)
    expect(off.some((t) => TOOL_META[t].group === 'creative')).toBe(false)
  })
})

test.describe('iterate keeps its slate schema whatever skill it runs on', () => {
  test('the schema is appended once, and its example is a slate', () => {
    const plain = buildIterateSystemPrompt('# A prompting skill with no schema', 'fallback')
    expect(plain.split('## Iteration Slate Mode').length - 1).toBe(1)
    expect(plain.startsWith('# A prompting skill with no schema')).toBe(true)
    const loopEdition = buildIterateSystemPrompt(kit.prompting!.skill_body, 'fallback')
    expect(loopEdition.split('## Iteration Slate Mode').length - 1).toBe(1)
    const already = buildIterateSystemPrompt(`x\n\n${ITERATION_SLATE_MODE}`, 'fallback')
    expect(already.split('## Iteration Slate Mode').length - 1).toBe(1)
    expect(buildIterateSystemPrompt(null, 'fallback').startsWith('fallback')).toBe(true)
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(ITERATION_SLATE_MODE)![1])
    expect(Object.keys(example).sort()).toEqual(['anchors', 'axesVaried', 'theme', 'variants', 'weakChangesAvoided'])
    expect(Object.keys(example.variants[0]).sort()).toEqual(['axis', 'change', 'label', 'preserve', 'prompt', 'whyDifferentEnough'])
  })
})
