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
  pluginOfTag,
  PRODUCT_KIT,
  repoPathOf,
  sha256Hex,
  STUDIO_KIT,
  tagPrefixes,
  type KitSource,
  type KitStore,
  type LoadedKit,
  type StoredKit,
} from '../src/lib/creative/kit'
import { ConformanceSchema, KitSchema, kitGraders, kitResults, ProductKitSchema, reportsOnly, type Kit, type ProductKit } from '../src/lib/creative/kit-schema'
import { kitSetPins, loadKitSet, resolveInKits, servedView, type KitSetLoaders } from '../src/lib/creative/kit-set'
import { findSkeletonFingerprint } from '../src/lib/prompts/product-prompt-guard'
import { runConformance } from '../src/lib/creative/conformance'
import { verdictFromKit } from '../src/lib/creative/ladder'
import { formatLine, isOurs, parseLine, GrammarError, type LineFields } from '../src/lib/creative/grammar'
import { clearRepoChoice, firstReachableKitSource, githubKitSource, isRepoMiss, KitNotInRepo, REPO_CHOICE_TTL_MS } from '../src/lib/creative/kit-github'
import { appJwt, InstallationTokenCache, InstallationTokenRefused, READ_PERMISSIONS, TOKEN_REFRESH_MARGIN_MS } from '../src/lib/github/app'
import { githubClient, GithubError, type Gh, type GhResponse } from '../src/lib/github/rest'
import { getProductKit, loadKitPrompting, productKitRepos } from '../src/lib/creative/kit-runtime'

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
      for (const v of vectors.ladder!) {
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
      // One name, or a plugin's old and new names.
      const names = plugin === undefined ? null : ([] as string[]).concat(plugin)
      return (
        [...kits]
          .filter((k) => k.valid && (!names || names.includes(k.kit?.plugin ?? '')))
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
      permissions: { contents: 'read', metadata: 'read' },
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
 * `/product-design:cmf-review`, the rubric under the plugin's `skills/`, CMF's own result rule (no
 * one-minor verdict: one failed minor check is a PASS with that check listed), its vectors
 * recomputed with it, no prompting, no comment line, no feedback block. Since product-design's
 * 5473bf3 the kit names the result rule `results`, the grading surfaces `graders` and says
 * `blocking: false` where the studio kit says `reporting_only: true`; its conformance file is that
 * commit's.
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
  test('validates as Loop Product Design, CMF only, and every CMF result vector reproduces', () => {
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
    expect(conf.products.cmf.results).toHaveLength(211)
    expect(conf.products.cmf.ladder).toBeUndefined()
    expect(kit.results.rank).toEqual(['PASS', 'RETRY', 'FAIL'])
    expect(kitResults(kit)).toBe(kit.results)
    expect(kitGraders(kit)).toBe(kit.graders)
    expect(new Set(conf.products.cmf.results!.map((v) => v.verdict))).toEqual(new Set(['PASS', 'RETRY', 'FAIL']))
  })

  test('it says blocking, false while every check only reports, and the tools read that as reports-only', () => {
    const kit = checkKit(P_KIT_BYTES, P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT).kit!
    expect(kit.products.cmf.rubric.blocking).toBe(false)
    expect(kit.products.cmf.rubric.reporting_only).toBeUndefined()
    expect(kit.products.cmf.grading?.blocking).toBe(false)
    expect(reportsOnly(kit.products.cmf.rubric)).toBe(true)
    expect(reportsOnly({ blocking: true })).toBe(false)
    const studio = checkKit(KIT_BYTES, PLUGIN_BYTES, CONF_BYTES).kit!
    expect(kitResults(studio)).toBe(studio.ladder)
    expect(kitGraders(studio)).toBe(studio.judges)
    for (const p of Object.values(studio.products)) expect(reportsOnly(p.rubric)).toBe(p.rubric.reporting_only)
  })

  test("a product kit in the studio kit's words is refused, and the studio kit keeps its own", () => {
    const oldNames = checkKit(
      withProductKit((k) => {
        k.ladder = k.results
        delete k.results
        k.judges = k.graders
        delete k.graders
      }),
      P_PLUGIN_BYTES,
      P_CONF_BYTES,
      PRODUCT_KIT
    )
    expect(oldNames.ok).toBe(false)
    expect(oldNames.problems.join()).toContain('kit.json results')
    expect(oldNames.problems.join()).toContain('kit.json graders')
    const oldFlag = checkKit(
      withProductKit((k) => {
        delete k.products.cmf.rubric.blocking
        k.products.cmf.rubric.reporting_only = true
      }),
      P_PLUGIN_BYTES,
      P_CONF_BYTES,
      PRODUCT_KIT
    )
    expect(oldFlag.ok).toBe(false)
    expect(oldFlag.problems.join()).toContain('kit.json products.cmf.rubric.blocking')
    expect(oldFlag.problems.join()).toContain('kit.json products.cmf.rubric.reporting_only')
    const studioNewFlag = checkKit(
      withKit((k) => {
        for (const p of Object.values(k.products) as any[]) p.rubric.blocking = !p.rubric.reporting_only
      }),
      PLUGIN_BYTES,
      CONF_BYTES
    )
    expect(studioNewFlag.ok).toBe(false)
    expect(studioNewFlag.problems.join()).toContain('rubric.blocking')
    const conf = JSON.parse(P_CONF_BYTES.toString('utf8'))
    conf.products.cmf.ladder = conf.products.cmf.results
    delete conf.products.cmf.results
    const confBytes = Buffer.from(JSON.stringify(conf))
    const oldVectors = checkKit(withProductKit((k) => (k.conformance.sha256 = sha256Hex(confBytes))), P_PLUGIN_BYTES, confBytes, PRODUCT_KIT)
    expect(oldVectors.ok).toBe(false)
    expect(oldVectors.problems.join()).toContain('conformance.json has no results vectors for cmf')
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

  test('without the App, CMF says where it is read from, under the repository\'s new name and its old one', async () => {
    await expect(getProductKit({ env: {} as NodeJS.ProcessEnv })).rejects.toThrow(
      "CMF is read from Loop AI Product Design's kit, tensalir/loop-ai-product (or tensalir/loop-product-plugins) at its newest ai-product-design-v* or product-design-v* tag (PRODUCT_KIT_REPO, PRODUCT_KIT_REF)"
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

// ------------------------------------------------------------------ the rename: both names are read

/**
 * Loop renames both plugins (studio-design to ai-studio-design, product-design to
 * ai-product-design) and the product kit's repository (tensalir/loop-product-plugins to
 * tensalir/loop-ai-product). Vesper reads both names, so the old-named releases production serves
 * today keep being served unchanged, the first new-named tag takes over, and neither half of the
 * rename can freeze or break a tool. The releases here are the sample kits re-versioned and, for
 * the new names, renamed: `plugin`, `tag`, the commands, plugin.json and the conformance file's
 * version. Their comment lines keep the `studio-design` prefix: the Frontify comment line is not
 * renamed.
 */

type Files = Record<string, Buffer>

function studioRelease(plugin: 'ai-studio-design' | 'studio-design', version: string, extra: Files = {}): Files {
  const conf = JSON.parse(CONF_BYTES.toString('utf8'))
  conf.version = version
  const confBytes = Buffer.from(JSON.stringify(conf))
  const kitBytes = withKit((k) => {
    k.plugin = plugin
    k.tag = `${plugin}-v${version}`
    k.version = version
    k.conformance.sha256 = sha256Hex(confBytes)
    for (const p of Object.values(k.products) as any[]) p.command = String(p.command).replace(/^\/studio-design:/, `/${plugin}:`)
  })
  const pluginBytes = Buffer.from(JSON.stringify({ ...JSON.parse(PLUGIN_BYTES.toString('utf8')), name: plugin, version }))
  const paths = kitPaths(plugin)
  return { [paths.kit]: kitBytes, [paths.pluginJson]: pluginBytes, [paths.conformance]: confBytes, ...extra }
}

function productRelease(plugin: 'ai-product-design' | 'product-design', version: string, extra: Files = {}): Files {
  const conf = JSON.parse(P_CONF_BYTES.toString('utf8'))
  conf.version = version
  const confBytes = Buffer.from(JSON.stringify(conf))
  const kitBytes = withProductKit((k) => {
    k.plugin = plugin
    k.tag = `${plugin}-v${version}`
    k.version = version
    k.conformance.sha256 = sha256Hex(confBytes)
    for (const p of Object.values(k.products) as any[]) p.command = String(p.command).replace(/^\/product-design:/, `/${plugin}:`)
  })
  const pluginBytes = Buffer.from(JSON.stringify({ ...JSON.parse(P_PLUGIN_BYTES.toString('utf8')), name: plugin, version }))
  const paths = kitPaths(plugin)
  return { [paths.kit]: kitBytes, [paths.pluginJson]: pluginBytes, [paths.conformance]: confBytes, ...extra }
}

/**
 * A repository as GitHub's REST API shows it to `githubKitSource`: refs by name, each a commit with
 * its files. A ref named `<name>-vX.Y.Z` is a tag, any other a branch. Every path asked is in `calls`.
 */
function fakeRepo(repo: string, refs: Record<string, Files>): Gh & { calls: string[] } {
  const calls: string[] = []
  const commitOf = (ref: string) => sha256Hex(`${repo}@${ref}`).slice(0, 40)
  const respond = (status: number, body?: unknown): GhResponse => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? {}))
    return {
      status,
      etag: null,
      bytes,
      json<T>() {
        return JSON.parse(bytes.toString('utf8')) as T
      },
    }
  }
  const gh: Gh = async (path, req = {}) => {
    calls.push(path)
    const base = `/repos/${repo}`
    if (!path.startsWith(`${base}/`)) return respond(404)
    const rest = path.slice(base.length)
    const tags = /^\/git\/matching-refs\/tags\/(.+)$/.exec(rest)
    if (tags) {
      const names = Object.keys(refs).filter((r) => r.startsWith(tags[1]) && /-v\d+\.\d+\.\d+$/.test(r))
      return respond(200, names.map((r) => ({ ref: `refs/tags/${r}`, object: { sha: commitOf(r), type: 'commit' } })))
    }
    const commit = /^\/commits\/(.+)$/.exec(rest)
    if (commit) {
      const ref = decodeURIComponent(commit[1])
      return refs[ref] ? respond(200, { sha: commitOf(ref) }) : respond(404)
    }
    const contents = /^\/contents\/(.+)\?ref=(.+)$/.exec(rest)
    if (contents) {
      const file = decodeURIComponent(contents[1])
      const ref = Object.keys(refs).find((r) => commitOf(r) === contents[2])
      const bytes = ref ? refs[ref][file] : undefined
      if (!bytes) return respond(404)
      if (req.accept === 'application/vnd.github.raw') return respond(200, bytes)
      return respond(200, { type: 'file', sha: `blob-${sha256Hex(bytes).slice(0, 12)}`, size: bytes.length, content: bytes.toString('base64'), encoding: 'base64' })
    }
    return respond(404)
  }
  return Object.assign(gh, { calls })
}

/** The kit.json files a repository was asked for, in order. */
function kitReads(gh: { calls: string[] }): string[] {
  return gh.calls.filter((c) => c.includes('/kit.json?')).map((c) => c.split('/contents/')[1].split('?')[0])
}

test.describe('the rename: the creative kit under both names', () => {
  test.beforeEach(() => clearKitMemory())

  test('the first ai-studio-design tag takes over from the last studio-design one, read from its own folder', async () => {
    const skill = Buffer.from('# eclipse, under the new name\n')
    const gh = fakeRepo('o/r', {
      'studio-design-v0.6.1': studioRelease('studio-design', '0.6.1'),
      'ai-studio-design-v0.7.0': studioRelease('ai-studio-design', '0.7.0', { 'plugins/ai-studio-design/skills/eclipse/SKILL.md': skill }),
    })
    const source = githubKitSource(gh, 'o/r')
    const store = memoryStore()
    const loaded = await loadCreativeKit({ source, store })
    expect(loaded.stale).toBe(false)
    expect([loaded.ref, loaded.kit.plugin, loaded.kit.version]).toEqual(['ai-studio-design-v0.7.0', 'ai-studio-design', '0.7.0'])
    // Both names' tags are listed; only the new name's folder is read.
    expect(gh.calls).toContain('/repos/o/r/git/matching-refs/tags/ai-studio-design-v')
    expect(gh.calls).toContain('/repos/o/r/git/matching-refs/tags/studio-design-v')
    expect(gh.calls.filter((c) => c.includes('/contents/plugins/studio-design/'))).toEqual([])
    // The files it names are read inside its own folder, and its comment lines keep the studio-design prefix.
    expect(await getKitFile(loaded, { path: 'skills/eclipse/SKILL.md', sha256: sha256Hex(skill) }, { source, store })).toEqual(skill)
    expect(loaded.kit.comment_line.prefix).toBe('studio-design')
    expect(loaded.kit.products.eclipse.command).toBe('/ai-studio-design:eclipse')
  })

  test('with only studio-design tags the old kit is served as before, and the new folder is never asked for', async () => {
    const gh = fakeRepo('o/r', {
      'studio-design-v0.6.0': studioRelease('studio-design', '0.6.0'),
      'studio-design-v0.6.1': studioRelease('studio-design', '0.6.1'),
    })
    const loaded = await loadCreativeKit({ source: githubKitSource(gh, 'o/r'), store: memoryStore() })
    expect(loaded.stale).toBe(false)
    expect([loaded.ref, loaded.kit.plugin, loaded.kit.version]).toEqual(['studio-design-v0.6.1', 'studio-design', '0.6.1'])
    expect(kitReads(gh)).toEqual(['plugins/studio-design/kit.json'])
  })

  test('the newest tag is the highest version under either name, the new name on a tie', () => {
    expect(newestTag(['refs/tags/studio-design-v0.6.1', 'refs/tags/ai-studio-design-v0.7.0'])).toBe('ai-studio-design-v0.7.0')
    expect(newestTag(['refs/tags/studio-design-v0.8.0', 'refs/tags/ai-studio-design-v0.7.0'])).toBe('studio-design-v0.8.0')
    expect(newestTag(['refs/tags/studio-design-v0.7.0', 'refs/tags/ai-studio-design-v0.7.0'])).toBe('ai-studio-design-v0.7.0')
    expect(newestTag(['refs/tags/ai-studio-design-v0.7.0'], 'studio-design-v')).toBeNull()
    expect(
      newestTag(['refs/tags/product-design-v0.2.3', 'refs/tags/ai-product-design-v0.3.0', 'refs/tags/ai-studio-design-v9.0.0'], tagPrefixes(PRODUCT_KIT))
    ).toBe('ai-product-design-v0.3.0')
    expect(pluginOfTag('ai-studio-design-v0.7.0', STUDIO_KIT.plugins)).toBe('ai-studio-design')
    expect(pluginOfTag('refs/tags/studio-design-v0.6.1', STUDIO_KIT.plugins)).toBe('studio-design')
    expect(pluginOfTag('main', STUDIO_KIT.plugins)).toBeNull()
    expect(pluginOfTag('product-design-v0.2.3', STUDIO_KIT.plugins)).toBeNull()
  })

  test('a refused ai-studio-design release keeps the last good studio-design kit, stale', async () => {
    const store = memoryStore()
    const today = { 'studio-design-v0.6.1': studioRelease('studio-design', '0.6.1') }
    await loadCreativeKit({ source: githubKitSource(fakeRepo('o/r', today), 'o/r'), store }, { force: true })
    const broken = studioRelease('ai-studio-design', '0.7.0')
    broken['plugins/ai-studio-design/.claude-plugin/plugin.json'] = Buffer.from(JSON.stringify({ name: 'ai-studio-design', version: '0.6.9' }))
    const gh = fakeRepo('o/r', { ...today, 'ai-studio-design-v0.7.0': broken })
    const loaded = await loadCreativeKit({ source: githubKitSource(gh, 'o/r'), store }, { force: true })
    expect(loaded.stale).toBe(true)
    expect([loaded.kit.plugin, loaded.kit.version]).toEqual(['studio-design', '0.6.1'])
    expect(loaded.staleReason).toContain('the kit at ai-studio-design-v0.7.0 was refused: plugin.json says 0.6.9, kit.json says 0.7.0')
  })

  test('a ref the env names is read from the new folder, and from the old one when the ref has only that', async () => {
    const gh = fakeRepo('o/r', {
      'preview-old': studioRelease('studio-design', '0.6.2'),
      'preview-both': { ...studioRelease('studio-design', '0.6.2'), ...studioRelease('ai-studio-design', '0.7.0') },
      'preview-none': { 'README.md': Buffer.from('no kit here\n') },
      'studio-design-v0.6.1': studioRelease('studio-design', '0.6.1'),
      'ai-studio-design-v0.7.0': studioRelease('ai-studio-design', '0.7.0'),
    })
    const store = memoryStore()
    const at = (ref: string) => loadCreativeKit({ source: githubKitSource(gh, 'o/r'), store, ref }, { force: true })

    const old = await at('preview-old')
    expect([old.stale, old.ref, old.kit.plugin, old.kit.version]).toEqual([false, 'preview-old', 'studio-design', '0.6.2'])
    expect(kitReads(gh)).toEqual(['plugins/ai-studio-design/kit.json', 'plugins/studio-design/kit.json'])
    expect((await at('preview-both')).kit.plugin).toBe('ai-studio-design')
    // A rollback to an old-named tag reads its old folder, though the repository has a newer new-named tag.
    const rollback = await at('studio-design-v0.6.1')
    expect([rollback.stale, rollback.kit.plugin, rollback.kit.version]).toEqual([false, 'studio-design', '0.6.1'])
    // A ref with neither folder is refused: the last good kit stays, stale; with none, a readable error.
    const none = await at('preview-none')
    expect(none.stale).toBe(true)
    expect(none.staleReason).toContain('preview-none has no plugins/ai-studio-design/kit.json or plugins/studio-design/kit.json')
    await expect(loadCreativeKit({ source: githubKitSource(gh, 'o/r'), store: memoryStore(), ref: 'preview-none' }, { force: true })).rejects.toThrow(
      'No creative kit is available'
    )
  })

  test("a release tag is read from its own name's folder, and a kit must be its folder's plugin", async () => {
    // An ai-studio-design tag at a commit that has only the old folder is refused, not read from the old folder.
    const gh = fakeRepo('o/r', { 'ai-studio-design-v0.7.0': studioRelease('studio-design', '0.6.1') })
    await expect(loadCreativeKit({ source: githubKitSource(gh, 'o/r'), store: memoryStore() }, { force: true })).rejects.toThrow(
      'ai-studio-design-v0.7.0 has no plugins/ai-studio-design/kit.json'
    )
    // A kit in the new folder that still calls itself studio-design is refused.
    const f = studioRelease('studio-design', '0.6.1')
    const misplaced = checkKit(f['plugins/studio-design/kit.json'], f['plugins/studio-design/.claude-plugin/plugin.json'], f['plugins/studio-design/kit/conformance.json'], STUDIO_KIT, 'ai-studio-design')
    expect(misplaced.ok).toBe(false)
    expect(misplaced.problems.join()).toContain('kit.json at plugins/ai-studio-design/kit.json names the plugin studio-design')
  })

  test("a kit whose tag is not its own plugin name's is refused, under either name, in either kit", () => {
    const renamed = studioRelease('ai-studio-design', '0.7.0')
    const good = checkKit(
      renamed['plugins/ai-studio-design/kit.json'],
      renamed['plugins/ai-studio-design/.claude-plugin/plugin.json'],
      renamed['plugins/ai-studio-design/kit/conformance.json'],
      STUDIO_KIT,
      'ai-studio-design'
    )
    expect(good.problems).toEqual([])
    const newNameOldTag = checkKit(withKit((k) => (k.plugin = 'ai-studio-design')), PLUGIN_BYTES, CONF_BYTES)
    expect(newNameOldTag.ok).toBe(false)
    expect(newNameOldTag.problems.join()).toContain('kit.json tag: the kit is ai-studio-design, so its tag is ai-studio-design-v<version>, not studio-design-v0.2.1')
    const oldNameNewTag = checkKit(withKit((k) => (k.tag = 'ai-studio-design-v0.2.1')), PLUGIN_BYTES, CONF_BYTES)
    expect(oldNameNewTag.ok).toBe(false)
    expect(oldNameNewTag.problems.join()).toContain('kit.json tag: the kit is studio-design')
    const productNewNameOldTag = checkKit(withProductKit((k) => (k.plugin = 'ai-product-design')), P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT)
    expect(productNewNameOldTag.ok).toBe(false)
    expect(productNewNameOldTag.problems.join()).toContain('kit.json tag: the kit is ai-product-design')
    const productOldNameNewTag = checkKit(withProductKit((k) => (k.tag = 'ai-product-design-v0.2.0')), P_PLUGIN_BYTES, P_CONF_BYTES, PRODUCT_KIT)
    expect(productOldNameNewTag.ok).toBe(false)
    expect(productOldNameNewTag.problems.join()).toContain('kit.json tag: the kit is product-design')
    // Each kit still refuses the other's names, old or new.
    const studioAsProduct = checkKit(
      withKit((k) => {
        k.plugin = 'ai-product-design'
        k.tag = 'ai-product-design-v0.2.1'
      }),
      PLUGIN_BYTES,
      CONF_BYTES
    )
    expect(studioAsProduct.ok).toBe(false)
    expect(studioAsProduct.problems.join()).toContain('kit.json plugin')
  })

  test('the kit is kept in memory as the creative kit, whatever its plugin is called', async () => {
    const store = memoryStore()
    const today = { 'studio-design-v0.6.1': studioRelease('studio-design', '0.6.1') }
    await loadCreativeKit({ source: githubKitSource(fakeRepo('o/r', today), 'o/r'), store })
    const renamed = githubKitSource(fakeRepo('o/r', { ...today, 'ai-studio-design-v0.7.0': studioRelease('ai-studio-design', '0.7.0') }), 'o/r')
    // Within the minute a new release does not split the memory in two: the same kit is served.
    expect((await loadCreativeKit({ source: renamed, store })).kit.plugin).toBe('studio-design')
    clearKitMemory('product')
    expect((await loadCreativeKit({ source: renamed, store })).kit.plugin).toBe('studio-design')
    clearKitMemory('studio')
    expect((await loadCreativeKit({ source: renamed, store })).kit.plugin).toBe('ai-studio-design')
  })

  test('renamed kits are told apart as before: CMF only from the product kit, the rest from the creative kit', async () => {
    const s = studioRelease('ai-studio-design', '0.7.0')
    const studio = loadedOf(KitSchema.parse(JSON.parse(s['plugins/ai-studio-design/kit.json'].toString('utf8'))), 'ai-studio-design-v0.7.0')
    const p = productRelease('ai-product-design', '0.3.0')
    const product = loadedOf(ProductKitSchema.parse(JSON.parse(p['plugins/ai-product-design/kit.json'].toString('utf8'))), 'ai-product-design-v0.3.0')
    expect(Object.keys(servedView(studio).kit.products).sort()).toEqual(['eclipse', 'packaging'])
    expect(servedView(product)).toBe(product)
    expect(kitResults(studio.kit)).toBe(studio.kit.ladder)
    expect(kitResults(product.kit)).toBe(product.kit.results)
    expect(kitGraders(product.kit)).toBe(product.kit.graders)
    const set = { studio: async () => studio, product: async () => product }
    const cmf = await resolveInKits(set, 'cmf')
    expect([cmf.source, cmf.product.command]).toEqual(['product', '/ai-product-design:cmf-review'])
    expect((await resolveInKits(set, 'eclipse')).source).toBe('studio')
  })
})

test.describe('the rename: the product kit under both repository names', () => {
  test.beforeEach(() => {
    clearKitMemory()
    clearRepoChoice()
  })

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

  /** The App's installation, holding only the repository names given: a token for any other name is refused with 422, as GitHub does. */
  function installation(names: readonly string[], minted: string[]) {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { repositories } = JSON.parse(String(init.body)) as { repositories: string[] }
      minted.push(repositories.join(','))
      if (!repositories.every((r) => names.includes(r))) {
        return new Response(
          JSON.stringify({ message: 'There is at least one repository that does not exist or is not accessible to the parent installation.' }),
          { status: 422 }
        )
      }
      return new Response(JSON.stringify({ token: 't', expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 })
    }) as unknown as typeof fetch
    return (repo: string) =>
      new InstallationTokenCache(
        { appId: '1', privateKeyPem: pem, installationId: '99', repositories: [repo.split('/')[1]], permissions: READ_PERMISSIONS },
        { fetchImpl }
      )
  }

  /** GitHub's REST API over fake repositories, by full name; any other name is a 404, and `status` answers every call. */
  function api(repos: Record<string, Gh>, status?: number): typeof fetch {
    return (async (url: string, init: RequestInit) => {
      if (status) return new Response('{}', { status })
      const path = url.replace('https://api.github.com', '')
      const gh = repos[path.split('/').slice(2, 4).join('/')]
      if (!gh) return new Response('{"message":"Not Found"}', { status: 404 })
      const res = await gh(path, { accept: (init.headers as Record<string, string>).Accept })
      return new Response(new Uint8Array(res.bytes), { status: res.status })
    }) as unknown as typeof fetch
  }

  /** The product kit's source as production builds it: each default repository name, with its own token. */
  function productSource(
    installed: readonly string[],
    repos: Record<string, Gh>,
    opts: { minted?: string[]; status?: Record<string, number>; now?: () => number } = {}
  ): KitSource {
    const tokens = installation(installed, opts.minted ?? [])
    return firstReachableKitSource(
      productKitRepos({} as NodeJS.ProcessEnv).map((repo) => ({
        repo,
        source: githubKitSource(
          githubClient({ tokens: tokens(repo), fetchImpl: api(repos, opts.status?.[repo]), sleep: async () => {} }),
          repo,
          tagPrefixes(PRODUCT_KIT)
        ),
      })),
      { now: opts.now }
    )
  }

  test('before the rename: tensalir/loop-ai-product is refused, and tensalir/loop-product-plugins serves product-design', async () => {
    expect(productKitRepos({} as NodeJS.ProcessEnv)).toEqual(['tensalir/loop-ai-product', 'tensalir/loop-product-plugins'])
    expect(productKitRepos({ PRODUCT_KIT_REPO: ' o/r ' } as unknown as NodeJS.ProcessEnv)).toEqual(['o/r'])

    const pantone = Buffer.from('{"table":[]}\n')
    const before = fakeRepo('tensalir/loop-product-plugins', {
      'product-design-v0.2.3': productRelease('product-design', '0.2.3', { 'plugins/product-design/skills/cmf-review/references/pantone.json': pantone }),
    })
    const minted: string[] = []
    let clock = Date.UTC(2026, 9, 3, 12, 0, 0)
    const source = productSource(['loop-product-plugins'], { 'tensalir/loop-product-plugins': before }, { minted, now: () => clock })
    const store = memoryStore()
    const loaded = await loadCreativeKit({ source, store, kit: PRODUCT_KIT })
    expect([loaded.stale, loaded.ref, loaded.kit.plugin, loaded.kit.version]).toEqual([false, 'product-design-v0.2.3', 'product-design', '0.2.3'])
    expect(minted[0]).toBe('loop-ai-product') // the new name is asked first, and refused
    const file = { path: 'skills/cmf-review/references/pantone.json', sha256: sha256Hex(pantone) }
    expect(await getKitFile(loaded, file, { source, store })).toEqual(pantone)
    // The name that answered is asked first from then on, so a read does not ask the missing name every time ...
    expect(minted.filter((m) => m === 'loop-ai-product')).toHaveLength(1)
    // ... for ten minutes; then the new name is asked first again.
    clock += REPO_CHOICE_TTL_MS
    expect(await getKitFile(loaded, file, { source, store })).toEqual(pantone)
    expect(minted.filter((m) => m === 'loop-ai-product')).toHaveLength(2)
  })

  test('after the rename: tensalir/loop-ai-product answers, and its first ai-product-design tag takes over', async () => {
    const after = fakeRepo('tensalir/loop-ai-product', {
      'product-design-v0.2.3': productRelease('product-design', '0.2.3'),
      'ai-product-design-v0.3.0': productRelease('ai-product-design', '0.3.0'),
    })
    const minted: string[] = []
    const loaded = await loadCreativeKit({ source: productSource(['loop-ai-product'], { 'tensalir/loop-ai-product': after }, { minted }), store: memoryStore(), kit: PRODUCT_KIT })
    expect([loaded.stale, loaded.ref, loaded.kit.plugin, loaded.kit.version]).toEqual([false, 'ai-product-design-v0.3.0', 'ai-product-design', '0.3.0'])
    expect(new Set(minted)).toEqual(new Set(['loop-ai-product'])) // the old name is never asked
    expect(kitReads(after)).toEqual(['plugins/ai-product-design/kit.json'])
  })

  test('a GitHub outage on the new name is not a reason to read the old one', async () => {
    const before = fakeRepo('tensalir/loop-product-plugins', { 'product-design-v0.2.3': productRelease('product-design', '0.2.3') })
    const source = productSource(['loop-ai-product', 'loop-product-plugins'], { 'tensalir/loop-product-plugins': before }, { status: { 'tensalir/loop-ai-product': 502 } })
    await expect(loadCreativeKit({ source, store: memoryStore(), kit: PRODUCT_KIT }, { force: true })).rejects.toThrow('No product kit is available')
    expect(before.calls).toEqual([])
    expect(isRepoMiss(new GithubError('x', 502))).toBe(false)
    expect(isRepoMiss(new GithubError('x', 0))).toBe(false)
    expect(isRepoMiss(new GithubError('x', 422))).toBe(true)
    expect(isRepoMiss(new InstallationTokenRefused(422, 'x'))).toBe(true)
    expect(isRepoMiss(new KitNotInRepo('x'))).toBe(true)
  })

  test('when neither name answers, the error names both', async () => {
    await expect(productSource([], {}).resolve(null, tagPrefixes(PRODUCT_KIT))).rejects.toThrow(
      /none of tensalir\/loop-ai-product, tensalir\/loop-product-plugins has it \(.*refused an installation token \(422\)/
    )
    // A repository that answers but has no kit tag yet is a miss too: the next name is asked.
    const empty = fakeRepo('tensalir/loop-ai-product', { main: { 'README.md': Buffer.from('new home\n') } })
    const before = fakeRepo('tensalir/loop-product-plugins', { 'product-design-v0.2.3': productRelease('product-design', '0.2.3') })
    const both = productSource(['loop-ai-product', 'loop-product-plugins'], { 'tensalir/loop-ai-product': empty, 'tensalir/loop-product-plugins': before })
    expect((await both.resolve(null, tagPrefixes(PRODUCT_KIT))).ref).toBe('product-design-v0.2.3')
  })
})
