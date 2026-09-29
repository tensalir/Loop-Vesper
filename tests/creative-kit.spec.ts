import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import {
  checkKit,
  clearKitMemory,
  getKitFile,
  kitPaths,
  loadCreativeKit,
  newestTag,
  PRODUCT_KIT,
  repoPathOf,
  sha256Hex,
  STUDIO_KIT,
  type KitSource,
  type KitStore,
  type LoadedKit,
  type StoredKit,
} from '../src/lib/creative/kit'
import { ConformanceSchema, KitSchema, ProductKitSchema, type Kit, type ProductKit } from '../src/lib/creative/kit-schema'
import { kitSetPins, loadKitSet, resolveInKits, servedView, type KitSetLoaders } from '../src/lib/creative/kit-set'
import { findSkeletonFingerprint } from '../src/lib/prompts/product-prompt-guard'
import { runConformance } from '../src/lib/creative/conformance'
import { verdictFromKit } from '../src/lib/creative/ladder'
import { formatLine, isOurs, parseLine, GrammarError, type LineFields } from '../src/lib/creative/grammar'
import { githubKitSource } from '../src/lib/creative/kit-github'
import { appJwt, InstallationTokenCache, READ_PERMISSIONS, TOKEN_REFRESH_MARGIN_MS } from '../src/lib/github/app'
import type { Gh, GhResponse } from '../src/lib/github/rest'
import { getProductKit, loadKitPrompting } from '../src/lib/creative/kit-runtime'

/**
 * The creative kit is the plugin repository's word, and Vesper must read it
 * the way the repository does. The fixtures are byte-for-byte copies of the
 * release creative-v0.2.1 (tensalir/loop-ai-studio#21, on #19), with the
 * plugin's identity moved to studio-design on 2026-09-28: `plugin`, `tag`,
 * `repo`, the comment-line prefix (the old `creative` now read also) and the
 * commands, and the conformance file's sha256 with its comment lines.
 */

const FIX = join(__dirname, 'fixtures', 'creative')
const KIT_BYTES = readFileSync(join(FIX, 'kit.v1.sample.json'))
const CONF_BYTES = readFileSync(join(FIX, 'conformance.v1.sample.json'))
const PLUGIN_BYTES = readFileSync(join(FIX, 'plugin.v1.sample.json'))
const kitJson = () => JSON.parse(KIT_BYTES.toString('utf8'))

function withKit(mutate: (k: any) => void): Buffer {
  const k = kitJson()
  mutate(k)
  return Buffer.from(JSON.stringify(k))
}

test.describe('the sample kit', () => {
  test('validates, and its conformance file is the one it names', () => {
    const parsed = KitSchema.safeParse(kitJson())
    expect(parsed.success).toBe(true)
    expect(sha256Hex(CONF_BYTES)).toBe(kitJson().conformance.sha256)
    const check = checkKit(KIT_BYTES, PLUGIN_BYTES, CONF_BYTES)
    expect(check.problems).toEqual([])
    expect(check.ok).toBe(true)
  })

  test('every ladder vector reproduces, for every product', () => {
    const kit = KitSchema.parse(kitJson())
    const conf = ConformanceSchema.parse(JSON.parse(CONF_BYTES.toString('utf8')))
    let n = 0
    for (const [slug, vectors] of Object.entries(conf.products)) {
      for (const v of vectors.ladder) {
        expect(verdictFromKit(kit.ladder, kit.products[slug].rubric.checks, v.failed), `${slug} ${v.failed}`).toBe(v.verdict)
        n += 1
      }
    }
    expect(n).toBe(872)
    expect(runConformance(kit, conf)).toEqual([])
  })

  test('every comment-line vector is written and read back the same', () => {
    const conf = ConformanceSchema.parse(JSON.parse(CONF_BYTES.toString('utf8')))
    expect(conf.comment_lines.length).toBeGreaterThan(0)
    for (const v of conf.comment_lines) {
      expect(formatLine(v.fields as unknown as LineFields)).toBe(v.line)
      expect(parseLine(v.line)?.prefix).toBe('studio-design')
    }
  })
})

test.describe('a kit is refused when', () => {
  test('its schema is not 1', () => {
    const check = checkKit(withKit((k) => (k.schema = 2)), PLUGIN_BYTES, CONF_BYTES)
    expect(check.ok).toBe(false)
    expect(check.problems[0]).toContain('schema 2')
  })

  test('it still names the plugin creative, its tag creative-v*, or writes the creative prefix', () => {
    const plugin = checkKit(withKit((k) => (k.plugin = 'creative')), PLUGIN_BYTES, CONF_BYTES)
    expect(plugin.ok).toBe(false)
    expect(plugin.problems.join()).toContain('kit.json plugin')
    const tag = checkKit(withKit((k) => (k.tag = 'creative-v0.2.1')), PLUGIN_BYTES, CONF_BYTES)
    expect(tag.ok).toBe(false)
    expect(tag.problems.join()).toContain('kit.json tag')
    const prefix = checkKit(withKit((k) => (k.comment_line.prefix = 'creative')), PLUGIN_BYTES, CONF_BYTES)
    expect(prefix.ok).toBe(false)
    expect(prefix.problems.join()).toContain('kit.json comment_line.prefix')
  })

  test('its ladder names a severity or verdict this Vesper does not know', () => {
    const a = checkKit(withKit((k) => (k.ladder.rules[0].severity = 'blocker')), PLUGIN_BYTES, CONF_BYTES)
    expect(a.ok).toBe(false)
    const b = checkKit(withKit((k) => (k.ladder.otherwise = 'OK')), PLUGIN_BYTES, CONF_BYTES)
    expect(b.ok).toBe(false)
  })

  test('plugin.json at the same commit has another version', () => {
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(PLUGIN_BYTES.toString('utf8')), version: '0.2.9' }))
    const check = checkKit(KIT_BYTES, other, CONF_BYTES)
    expect(check.ok).toBe(false)
    expect(check.problems.join()).toContain('plugin.json says 0.2.9')
  })

  test('the conformance file is not the one the kit names', () => {
    const check = checkKit(KIT_BYTES, PLUGIN_BYTES, Buffer.concat([CONF_BYTES, Buffer.from(' ')]))
    expect(check.ok).toBe(false)
    expect(check.problems.join()).toContain('does not have the sha256')
  })

  test('its ladder no longer gives the repository\'s verdicts', () => {
    // A gate failure read as RETRY: every vector with a gate check now differs.
    const check = checkKit(withKit((k) => (k.ladder.rules[0].verdict = 'RETRY')), PLUGIN_BYTES, CONF_BYTES)
    expect(check.ok).toBe(false)
    expect(check.problems.join()).toContain('the repo says FAIL')
  })
})

// ------------------------------------------------------------------ loading

function memoryStore(seed: StoredKit[] = []): KitStore & { kits: StoredKit[]; files: Map<string, { sha256: string; content: Buffer }> } {
  const kits = [...seed]
  const files = new Map<string, { sha256: string; content: Buffer }>()
  return {
    kits,
    files,
    async getByBlob(blobSha) {
      return kits.find((k) => k.blobSha === blobSha) ?? null
    },
    async latestValid(plugin) {
      return (
        [...kits]
          .filter((k) => k.valid && (!plugin || k.kit?.plugin === plugin))
          .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0] ?? null
      )
    },
    async save(kit) {
      const i = kits.findIndex((k) => k.blobSha === kit.blobSha)
      if (i >= 0) kits[i] = kit
      else kits.push(kit)
    },
    async getFile(blobSha) {
      return files.get(blobSha) ?? null
    },
    async saveFile(f) {
      files.set(f.blobSha, { sha256: f.sha256, content: f.content })
    },
  }
}

function fixtureSource(
  kitBytes: Buffer,
  opts: { fail?: boolean; extra?: Record<string, Buffer>; plugin?: 'studio-design' | 'product-design'; pluginBytes?: Buffer; confBytes?: Buffer } = {}
): KitSource & { calls: string[] } {
  const calls: string[] = []
  const paths = kitPaths(opts.plugin ?? 'studio-design')
  const files: Record<string, Buffer> = {
    [paths.kit]: kitBytes,
    [paths.pluginJson]: opts.pluginBytes ?? PLUGIN_BYTES,
    [paths.conformance]: opts.confBytes ?? CONF_BYTES,
    ...(opts.extra ?? {}),
  }
  return {
    calls,
    async resolve(ref) {
      if (opts.fail) throw new Error('GitHub is down')
      return { ref: ref ?? `${paths.tagPrefix}0.2.0`, commit: 'c0ffee0000000000000000000000000000000000' }
    },
    async getFile(path) {
      calls.push(path)
      const bytes = files[path]
      return bytes ? { blobSha: `blob-${sha256Hex(bytes).slice(0, 12)}`, bytes } : null
    },
  }
}

test.describe('loading the kit', () => {
  test.beforeEach(() => clearKitMemory())

  test('a good kit is checked once, stored, and served fresh', async () => {
    const store = memoryStore()
    const source = fixtureSource(KIT_BYTES)
    const loaded = await loadCreativeKit({ source, store })
    expect(loaded.stale).toBe(false)
    expect(loaded.kit.version).toBe('0.2.1')
    expect(store.kits).toHaveLength(1)
    expect(store.kits[0].valid).toBe(true)
    // A second read within a minute comes from memory, a later one by its blob without re-checking.
    await loadCreativeKit({ source, store })
    expect(source.calls.filter((c) => c.endsWith('conformance.json'))).toHaveLength(1)
    clearKitMemory()
    const again = await loadCreativeKit({ source, store })
    expect(again.stale).toBe(false)
    expect(source.calls.filter((c) => c.endsWith('conformance.json'))).toHaveLength(1)
  })

  test('a refused new kit keeps the last good one, marked stale', async () => {
    const store = memoryStore()
    await loadCreativeKit({ source: fixtureSource(KIT_BYTES), store }, { force: true })
    const bad = withKit((k) => {
      k.version = '0.2.2'
      k.tag = 'studio-design-v0.2.2'
    })
    const loaded = await loadCreativeKit({ source: fixtureSource(bad), store }, { force: true })
    expect(loaded.stale).toBe(true)
    expect(loaded.kit.version).toBe('0.2.1')
    expect(loaded.staleReason).toContain('plugin.json says 0.2.1, kit.json says 0.2.2')
    expect(store.kits.find((k) => !k.valid)?.error).toContain('0.2.2')
  })

  test('GitHub unreachable: the last good kit, stale; with none, a readable error', async () => {
    const store = memoryStore()
    await expect(loadCreativeKit({ source: fixtureSource(KIT_BYTES, { fail: true }), store }, { force: true })).rejects.toThrow(
      'No creative kit is available'
    )
    await loadCreativeKit({ source: fixtureSource(KIT_BYTES), store }, { force: true })
    const loaded = await loadCreativeKit({ source: fixtureSource(KIT_BYTES, { fail: true }), store }, { force: true })
    expect(loaded.stale).toBe(true)
    expect(loaded.staleReason).toContain('GitHub is down')
  })

  test('a file the kit names is served only with the sha256 the kit gives it', async () => {
    const store = memoryStore()
    const good = Buffer.from('# rubric\n')
    const source = fixtureSource(KIT_BYTES, { extra: { 'products/eclipse/skill/references/rubric.md': good } })
    const file = { path: 'products/eclipse/skill/references/rubric.md', sha256: sha256Hex(good) }
    expect((await getKitFile({ commit: 'c0ffee' }, file, { source, store })).toString()).toBe('# rubric\n')
    await expect(getKitFile({ commit: 'c0ffee' }, { ...file, sha256: '0'.repeat(64) }, { source, store })).rejects.toThrow(
      'does not have the sha256'
    )
    expect(repoPathOf('skills/eclipse/SKILL.md')).toBe('plugins/studio-design/skills/eclipse/SKILL.md')
    expect(repoPathOf('kit/conformance.json')).toBe('plugins/studio-design/kit/conformance.json')
    expect(repoPathOf('workstreams/cmf/x.json')).toBe('workstreams/cmf/x.json')
  })
})

test.describe('the release tag', () => {
  test('the newest by version, not by name', () => {
    expect(newestTag(['refs/tags/studio-design-v0.9.9', 'refs/tags/studio-design-v0.10.0', 'refs/tags/studio-design-v0.3.0'])).toBe('studio-design-v0.10.0')
    expect(newestTag(['refs/tags/studio-design-v1.0.0-rc1', 'refs/tags/other-v9.0.0'])).toBeNull()
    // The plugin's tags before 2026-09-28 are not read, however new.
    expect(newestTag(['refs/tags/creative-v9.9.9', 'refs/tags/studio-design-v0.3.0'])).toBe('studio-design-v0.3.0')
    expect(newestTag(['refs/tags/creative-v0.2.4'])).toBeNull()
  })

  function fakeGh(routes: Record<string, unknown>): Gh {
    return async (path, req = {}) => {
      const key = req.accept === 'application/vnd.github.raw' ? `RAW ${path}` : path
      const body = routes[key]
      const res: GhResponse = {
        status: body === undefined ? 404 : 200,
        etag: null,
        bytes: Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? {})),
        json<T>() {
          return JSON.parse(this.bytes.toString('utf8')) as T
        },
      }
      return res
    }
  }

  test('a lightweight tag points at its commit; an annotated one is followed', async () => {
    const light = githubKitSource(
      fakeGh({
        '/repos/o/r/git/matching-refs/tags/studio-design-v': [
          { ref: 'refs/tags/studio-design-v0.2.9', object: { sha: 'old', type: 'commit' } },
          { ref: 'refs/tags/studio-design-v0.3.0', object: { sha: 'abc', type: 'commit' } },
        ],
      }),
      'o/r'
    )
    expect(await light.resolve(null)).toEqual({ ref: 'studio-design-v0.3.0', commit: 'abc' })
    const annotated = githubKitSource(
      fakeGh({
        '/repos/o/r/git/matching-refs/tags/studio-design-v': [{ ref: 'refs/tags/studio-design-v0.3.0', object: { sha: 'tagobj', type: 'tag' } }],
        '/repos/o/r/git/tags/tagobj': { object: { sha: 'def' } },
      }),
      'o/r'
    )
    expect(await annotated.resolve(null)).toEqual({ ref: 'studio-design-v0.3.0', commit: 'def' })
    const pinned = githubKitSource(fakeGh({ '/repos/o/r/commits/my-branch': { sha: 'ghi' } }), 'o/r')
    expect(await pinned.resolve('my-branch')).toEqual({ ref: 'my-branch', commit: 'ghi' })
  })

  test('a small file comes base64, a large one raw', async () => {
    const small = Buffer.from('{"a":1}')
    const src = githubKitSource(
      fakeGh({
        '/repos/o/r/contents/plugins/studio-design/kit.json?ref=abc': { type: 'file', sha: 'b1', size: small.length, content: small.toString('base64'), encoding: 'base64' },
        '/repos/o/r/contents/big.json?ref=abc': { type: 'file', sha: 'b2', size: 2_000_000, content: '', encoding: 'none' },
        'RAW /repos/o/r/contents/big.json?ref=abc': Buffer.from('BIG'),
      }),
      'o/r'
    )
    expect(await src.getFile('plugins/studio-design/kit.json', 'abc')).toEqual({ blobSha: 'b1', bytes: small })
    expect((await src.getFile('big.json', 'abc'))?.bytes.toString()).toBe('BIG')
    expect(await src.getFile('missing.json', 'abc')).toBeNull()
  })
})

test.describe("Vesper's GitHub App", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

  test('its JWT is RS256, issued a minute back, valid under ten minutes', () => {
    const now = Date.UTC(2026, 8, 24, 12, 0, 0)
    const token = appJwt({ appId: '12345', privateKeyPem: pem }, now)
    const claims = jwt.verify(token, publicKey.export({ type: 'spki', format: 'pem' }).toString(), {
      algorithms: ['RS256'],
      clockTimestamp: now / 1000,
    }) as jwt.JwtPayload
    expect(claims.iss).toBe('12345')
    expect(claims.iat).toBe(now / 1000 - 60)
    expect(claims.exp).toBe(now / 1000 + 540)
  })

  test('the installation token is cached until five minutes before it lapses, then minted again', async () => {
    let clock = Date.UTC(2026, 8, 24, 12, 0, 0)
    const minted: Array<{ url: string; body: any }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      minted.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(
        JSON.stringify({ token: `tok-${minted.length}`, expires_at: new Date(clock + 60 * 60 * 1000).toISOString() }),
        { status: 201 }
      )
    }) as unknown as typeof fetch
    const cache = new InstallationTokenCache(
      { appId: '1', privateKeyPem: pem, installationId: '99', repositories: ['loop-ai-studio'] },
      { fetchImpl, now: () => clock }
    )
    const [a, b] = await Promise.all([cache.getToken(), cache.getToken()])
    expect(a).toBe('tok-1')
    expect(b).toBe('tok-1')
    expect(minted).toHaveLength(1)
    expect(minted[0].url).toContain('/app/installations/99/access_tokens')
    expect(minted[0].body).toEqual({
      repositories: ['loop-ai-studio'],
      permissions: { contents: 'read', issues: 'write', metadata: 'read' },
    })
    clock += 60 * 60 * 1000 - TOKEN_REFRESH_MARGIN_MS - 1000
    expect(await cache.getToken()).toBe('tok-1')
    clock += 2000
    expect(await cache.getToken()).toBe('tok-2')
    cache.invalidate()
    expect(await cache.getToken()).toBe('tok-3')
  })

  test('without the App, the prompt rewrite does not reach for a kit', async () => {
    expect(await loadKitPrompting({} as NodeJS.ProcessEnv)).toBeNull()
  })
})

test.describe('the comment-line grammar', () => {
  test('reads the older prefixes and the vesper judge, and refuses what would not read back', () => {
    const old = parseLine('[asset-review eclipse 2026-09-23] no | decoded B3,C4? | grade RETRY B2,C1 | judge m qa x3 | rubric 0.5.3 | a | b')
    expect(old).toMatchObject({ prefix: 'asset-review', decoded: ['B3'], decodedUnconfirmed: ['C4'], failed: ['B2', 'C1'], remark: 'a | b' })
    const creative = parseLine('[creative eclipse 2026-09-27] yes | decoded - | grade PASS | judge m vesper x3 | rubric 0.5.3 | -')
    expect(creative).toMatchObject({ prefix: 'creative', answer: 'yes', verdict: 'PASS', surface: 'vesper' })
    expect(isOurs('[creative eclipse 2026-09-27] yes')).toBe(true)
    expect(parseLine('Looks great')).toBeNull()
    expect(() => parseLine('[studio-design eclipse 2026-09-23] maybe | x')).toThrow(GrammarError)
    expect(() => parseLine('[creative eclipse 2026-09-23] maybe | x')).toThrow(GrammarError)
    const base = { product: 'eclipse', date: '2026-10-02', answer: 'yes', remark: '', judge: 'm', surface: 'vesper', reads: 3, rubric: '0.5.3' }
    expect(formatLine(base)).toBe('[studio-design eclipse 2026-10-02] yes | decoded - | grade - | judge m vesper x3 | rubric 0.5.3 | -')
    expect(() => formatLine({ ...base, surface: 'slack' })).toThrow(GrammarError)
    expect(() => formatLine({ ...base, decoded: ['b3'] })).toThrow(GrammarError)
  })
})

// ------------------------------------------------------------------ the product kit

/**
 * Loop Product Design's kit, CMF only, read from tensalir/loop-product-plugins at its
 * product-design-v* tag. The sample is the studio release's CMF parts moved into it: the command
 * `/product-design:cmf-review`, the rubric under the plugin's `skills/`, CMF's own ladder (no
 * one-minor verdict: one failed minor check is a PASS with that check listed), the ladder vectors
 * recomputed with it, no prompting, no comment line, no feedback block.
 */
const P_KIT_BYTES = readFileSync(join(FIX, 'product-kit.v1.sample.json'))
const P_CONF_BYTES = readFileSync(join(FIX, 'product-conformance.v1.sample.json'))
const P_PLUGIN_BYTES = readFileSync(join(FIX, 'product-plugin.v1.sample.json'))
const productJson = () => JSON.parse(P_KIT_BYTES.toString('utf8'))

function withProductKit(mutate: (k: any) => void): Buffer {
  const k = productJson()
  mutate(k)
  return Buffer.from(JSON.stringify(k))
}

test.describe('the product kit', () => {
  test('validates as Loop Product Design, CMF only, and every CMF ladder vector reproduces', () => {
    const check = checkKit(P_KIT_BYTES, P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT)
    expect(check.problems).toEqual([])
    expect(check.ok).toBe(true)
    const kit = check.kit!
    expect(kit.plugin).toBe('product-design')
    expect(kit.tag).toBe('product-design-v0.2.0')
    expect(Object.keys(kit.products)).toEqual(['cmf'])
    expect(kit.products.cmf.command).toBe('/product-design:cmf-review')
    expect(kit.prompting).toBeNull()
    expect(kit.comment_line ?? null).toBeNull()
    expect(kit.feedback ?? null).toBeNull()
    const conf = check.conformance!
    expect(conf.comment_lines).toEqual([])
    expect(conf.products.cmf.ladder).toHaveLength(211)
    expect(kit.ladder.rank).toEqual(['PASS', 'RETRY', 'FAIL'])
    expect(new Set(conf.products.cmf.ladder.map((v) => v.verdict))).toEqual(new Set(['PASS', 'RETRY', 'FAIL']))
  })

  test('its CMF template is a prompt no model rewrites', () => {
    const fp = (productJson().products.cmf.template.fingerprint as string)
    expect(fp.length).toBeGreaterThanOrEqual(8)
    expect(findSkeletonFingerprint(`${fp} and the rest of the filled template`)).not.toBeNull()
  })

  test("each kit is refused as the other, and with the other's tag", () => {
    const asStudio = checkKit(P_KIT_BYTES, P_PLUGIN_BYTES, P_CONF_BYTES, STUDIO_KIT)
    expect(asStudio.ok).toBe(false)
    expect(asStudio.problems.join()).toContain('kit.json plugin')
    const asProduct = checkKit(KIT_BYTES, PLUGIN_BYTES, CONF_BYTES, PRODUCT_KIT)
    expect(asProduct.ok).toBe(false)
    expect(asProduct.problems.join()).toContain('kit.json plugin')
    const studioWithProductTag = checkKit(withKit((k) => (k.tag = 'product-design-v0.2.1')), PLUGIN_BYTES, CONF_BYTES)
    expect(studioWithProductTag.ok).toBe(false)
    expect(studioWithProductTag.problems.join()).toContain('kit.json tag')
    const productWithStudioTag = checkKit(withProductKit((k) => (k.tag = 'studio-design-v0.2.0')), P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT)
    expect(productWithStudioTag.ok).toBe(false)
    expect(productWithStudioTag.problems.join()).toContain('kit.json tag')
  })

  test('a product kit writing a comment line, or conformance carrying comment lines, is refused', () => {
    const line = checkKit(withProductKit((k) => (k.comment_line = kitJson().comment_line)), P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT)
    expect(line.ok).toBe(false)
    expect(line.problems.join()).toContain('kit.json comment_line')
    const conf = JSON.parse(P_CONF_BYTES.toString('utf8'))
    conf.comment_lines = JSON.parse(CONF_BYTES.toString('utf8')).comment_lines
    const confBytes = Buffer.from(JSON.stringify(conf))
    const withLines = checkKit(withProductKit((k) => (k.conformance.sha256 = sha256Hex(confBytes))), P_PLUGIN_BYTES, confBytes, PRODUCT_KIT)
    expect(withLines.ok).toBe(false)
    expect(withLines.problems.join()).toContain('and the kit writes none')
  })

  test('its release tags are product-design-v*, the newest by version', () => {
    const refs = ['refs/tags/product-design-v0.2.0', 'refs/tags/product-design-v0.10.0', 'refs/tags/studio-design-v9.0.0']
    expect(newestTag(refs, kitPaths('product-design').tagPrefix)).toBe('product-design-v0.10.0')
    expect(newestTag(refs)).toBe('studio-design-v9.0.0')
    expect(newestTag(['refs/tags/studio-design-v0.3.0'], 'product-design-v')).toBeNull()
  })

  test("a skills/ or kit/ path is read inside the kit's own plugin folder", async () => {
    expect(repoPathOf('skills/cmf-review/references/pantone.json', kitPaths('product-design').root)).toBe(
      'plugins/product-design/skills/cmf-review/references/pantone.json'
    )
    expect(repoPathOf('workstreams/cmf/references/workbook/spec/link.json', kitPaths('product-design').root)).toBe(
      'workstreams/cmf/references/workbook/spec/link.json'
    )
    const bytes = Buffer.from('{"table":[]}\n')
    const store = memoryStore()
    const source = fixtureSource(P_KIT_BYTES, { plugin: 'product-design', extra: { 'plugins/product-design/skills/cmf-review/references/pantone.json': bytes } })
    const file = { path: 'skills/cmf-review/references/pantone.json', sha256: sha256Hex(bytes) }
    expect(await getKitFile({ commit: 'c0ffee', kit: { plugin: 'product-design' } }, file, { source, store })).toEqual(bytes)
    // Read as the studio kit's, the same path is not there.
    await expect(getKitFile({ commit: 'c0ffee' }, file, { source, store })).rejects.toThrow('plugins/studio-design/skills/cmf-review')
  })

  test('without the App, CMF says where it is read from', async () => {
    await expect(getProductKit({ env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      "CMF is read from Loop Product Design's kit, tensalir/loop-product-plugins at its newest product-design-v* tag (PRODUCT_KIT_REPO, PRODUCT_KIT_REF)"
    )
  })

  test("the product kit's token only reads, and only its own repository", async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const bodies: any[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 })
    }) as unknown as typeof fetch
    const cache = new InstallationTokenCache(
      { appId: '1', privateKeyPem: pem, installationId: '99', repositories: ['loop-product-plugins'], permissions: READ_PERMISSIONS },
      { fetchImpl }
    )
    await cache.getToken()
    expect(bodies[0]).toEqual({ repositories: ['loop-product-plugins'], permissions: { contents: 'read', metadata: 'read' } })
  })
})

test.describe('loading two kits', () => {
  test.beforeEach(() => clearKitMemory())

  test('each kit loads from its own paths and is kept in memory apart', async () => {
    const store = memoryStore()
    const studio = await loadCreativeKit({ source: fixtureSource(KIT_BYTES), store })
    const product = await loadCreativeKit({
      source: fixtureSource(P_KIT_BYTES, { plugin: 'product-design', pluginBytes: P_PLUGIN_BYTES, confBytes: P_CONF_BYTES }),
      store,
      kit: PRODUCT_KIT,
    })
    expect(studio.kit.plugin).toBe('studio-design')
    expect(product.kit.plugin).toBe('product-design')
    expect(product.ref).toBe('product-design-v0.2.0')
    // Within the minute each is served from its own memory.
    expect((await loadCreativeKit({ source: fixtureSource(KIT_BYTES, { fail: true }), store })).kit.plugin).toBe('studio-design')
    expect(store.kits.map((k) => k.kit?.plugin).sort()).toEqual(['product-design', 'studio-design'])
  })

  test("one kit's last good copy is never the other's fallback", async () => {
    const store = memoryStore()
    await loadCreativeKit({ source: fixtureSource(KIT_BYTES), store }, { force: true })
    const productDown = { source: fixtureSource(P_KIT_BYTES, { plugin: 'product-design', fail: true }), store, kit: PRODUCT_KIT }
    await expect(loadCreativeKit(productDown, { force: true })).rejects.toThrow('No product kit is available')
    // A store that ignores the plugin it is asked for still cannot hand over the other kit.
    const careless: KitStore = { ...store, latestValid: async () => store.kits[0] }
    await expect(loadCreativeKit({ ...productDown, store: careless }, { force: true })).rejects.toThrow('No product kit is available')

    const store2 = memoryStore()
    await loadCreativeKit(
      { source: fixtureSource(P_KIT_BYTES, { plugin: 'product-design', pluginBytes: P_PLUGIN_BYTES, confBytes: P_CONF_BYTES }), store: store2, kit: PRODUCT_KIT },
      { force: true }
    )
    await expect(loadCreativeKit({ source: fixtureSource(KIT_BYTES, { fail: true }), store: store2 }, { force: true })).rejects.toThrow(
      'No creative kit is available'
    )
    const stale = await loadCreativeKit(
      { source: fixtureSource(P_KIT_BYTES, { plugin: 'product-design', fail: true }), store: store2, kit: PRODUCT_KIT },
      { force: true }
    )
    expect(stale.stale).toBe(true)
    expect(stale.kit.plugin).toBe('product-design')
  })

  test('the studio kit validates and serves with no CMF in it', () => {
    const conf = JSON.parse(CONF_BYTES.toString('utf8'))
    delete conf.products.cmf
    const confBytes = Buffer.from(JSON.stringify(conf))
    const kitBytes = withKit((k) => {
      delete k.products.cmf
      k.conformance.sha256 = sha256Hex(confBytes)
    })
    const check = checkKit(kitBytes, PLUGIN_BYTES, confBytes)
    expect(check.problems).toEqual([])
    expect(Object.keys(check.kit!.products).sort()).toEqual(['eclipse', 'packaging'])
  })
})

// ------------------------------------------------------------------ two kits, one list of products

function loadedOf<K extends Kit | ProductKit>(kit: K, ref: string): LoadedKit<K> {
  return { kit, conformance: null as never, ref, commit: 'c0ffee0000000000000000000000000000000000', blobSha: 'b', fetchedAt: new Date(), stale: false, staleReason: null }
}

const studioLoaded = loadedOf(KitSchema.parse(kitJson()), 'studio-design-v0.2.1')
const productLoaded = loadedOf(ProductKitSchema.parse(productJson()), 'product-design-v0.2.0')

function loaders(opts: { studio?: Error; product?: Error } = {}): KitSetLoaders & { productCalls: number } {
  const l = {
    productCalls: 0,
    async studio() {
      if (opts.studio) throw opts.studio
      return studioLoaded
    },
    async product() {
      l.productCalls += 1
      if (opts.product) throw opts.product
      return productLoaded
    },
  }
  return l
}

test.describe('two kits, one list of products', () => {
  test("CMF comes from the product kit even while the creative kit still carries it; the rest from the creative kit", async () => {
    expect(Object.keys(studioLoaded.kit.products)).toContain('cmf') // studio-design 0.2.x still carries CMF
    for (const name of ['cmf', 'CMF sheet', 'cmf-review']) {
      const hit = await resolveInKits(loaders(), name)
      expect(hit.source, name).toBe('product')
      expect(hit.loaded.kit.plugin).toBe('product-design')
      expect(hit.product.command).toBe('/product-design:cmf-review')
    }
    const l = loaders()
    const eclipse = await resolveInKits(l, 'the sleep mask')
    expect(eclipse.source).toBe('studio')
    expect(eclipse.slug).toBe('eclipse')
    expect(l.productCalls).toBe(0) // an Eclipse call never waits on the product kit
    expect((await resolveInKits(loaders(), 'Coachella box')).slug).toBe('packaging')
  })

  test('no product kit: a CMF name gets its reason, never the creative kit\'s old CMF; the rest still works', async () => {
    const down = new Error("CMF is read from Loop Product Design's kit, tensalir/loop-product-plugins at its newest product-design-v* tag (PRODUCT_KIT_REPO, PRODUCT_KIT_REF), and none can be read")
    await expect(resolveInKits(loaders({ product: down }), 'cmf')).rejects.toThrow('PRODUCT_KIT_REPO')
    await expect(resolveInKits(loaders({ product: down }), 'clown render')).rejects.toThrow('PRODUCT_KIT_REPO')
    expect((await resolveInKits(loaders({ product: down }), 'eclipse')).source).toBe('studio')
    await expect(resolveInKits(loaders({ product: down }), 'Loop Dream')).rejects.toThrow("No Loop product called 'Loop Dream'")
  })

  test('no creative kit: CMF still works, and an Eclipse name gets the creative kit\'s reason', async () => {
    const down = new Error('No creative kit is available: GitHub is down')
    expect((await resolveInKits(loaders({ studio: down }), 'cmf')).source).toBe('product')
    await expect(resolveInKits(loaders({ studio: down }), 'eclipse')).rejects.toThrow('No creative kit is available')
  })

  test('an unknown name lists what both kits serve', async () => {
    const err = await resolveInKits(loaders(), 'Loop Dream').catch((e: Error) => e)
    expect((err as Error).message).toContain("No Loop product called 'Loop Dream' in Vesper's kits")
    expect((err as Error).message).toContain('(eclipse)')
    expect((err as Error).message).toContain('(cmf)')
  })

  test('the creative kit is served without its CMF; the pins are its own and CMF\'s clowns once', async () => {
    expect(Object.keys(servedView(studioLoaded).kit.products).sort()).toEqual(['eclipse', 'packaging'])
    expect(servedView(productLoaded)).toBe(productLoaded)
    const set = await loadKitSet(loaders())
    const pins = kitSetPins(set)
    expect(pins.filter((p) => p.product === 'cmf')).toHaveLength(25)
    expect(pins.filter((p) => p.product === 'eclipse')).toHaveLength(18)
    const onlyStudio = await loadKitSet(loaders({ product: new Error('down') }))
    expect(onlyStudio.product).toBeNull()
    expect(onlyStudio.productError?.message).toBe('down')
    expect(kitSetPins(onlyStudio).some((p) => p.product === 'cmf')).toBe(false)
    await expect(loadKitSet(loaders({ studio: new Error('a'), product: new Error('b') }))).rejects.toThrow('a')
  })
})
