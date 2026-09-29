import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import {
  checkKit,
  clearKitMemory,
  getKitFile,
  loadCreativeKit,
  newestTag,
  repoPathOf,
  sha256Hex,
  type KitSource,
  type KitStore,
  type StoredKit,
} from '../src/lib/creative/kit'
import { ConformanceSchema, KitSchema } from '../src/lib/creative/kit-schema'
import { runConformance } from '../src/lib/creative/conformance'
import { verdictFromKit } from '../src/lib/creative/ladder'
import { formatLine, isOurs, parseLine, GrammarError, type LineFields } from '../src/lib/creative/grammar'
import { githubKitSource } from '../src/lib/creative/kit-github'
import { appJwt, InstallationTokenCache, TOKEN_REFRESH_MARGIN_MS } from '../src/lib/github/app'
import type { Gh, GhResponse } from '../src/lib/github/rest'
import { loadKitPrompting } from '../src/lib/creative/kit-runtime'

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
    async latestValid() {
      return [...kits].filter((k) => k.valid).sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0] ?? null
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

function fixtureSource(kitBytes: Buffer, opts: { fail?: boolean; extra?: Record<string, Buffer> } = {}): KitSource & { calls: string[] } {
  const calls: string[] = []
  const files: Record<string, Buffer> = {
    'plugins/studio-design/kit.json': kitBytes,
    'plugins/studio-design/.claude-plugin/plugin.json': PLUGIN_BYTES,
    'plugins/studio-design/kit/conformance.json': CONF_BYTES,
    ...(opts.extra ?? {}),
  }
  return {
    calls,
    async resolve(ref) {
      if (opts.fail) throw new Error('GitHub is down')
      return { ref: ref ?? 'studio-design-v0.2.0', commit: 'c0ffee0000000000000000000000000000000000' }
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
