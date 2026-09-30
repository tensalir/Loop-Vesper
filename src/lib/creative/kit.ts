/**
 * The Loop kits: what Vesper reads from the plugin repositories.
 *
 * Two plugins publish a kit, each from its own repository, in the same shape
 * (`./kit-schema.ts`):
 *   - `studio-design` (Loop Studio Design, `tensalir/loop-ai-studio`): Eclipse,
 *     packaging and the prompting skill. Its builder writes
 *     `plugins/studio-design/kit.json` and `plugins/studio-design/kit/conformance.json`;
 *     a merge that raises the plugin's version is tagged `studio-design-v<version>`
 *     (the plugin was `creative`, tagged `creative-v*`, until 2026-09-28; those
 *     tags are no longer read, and a kit still naming `creative` is refused).
 *   - `product-design` (Loop Product Design, `tensalir/loop-product-plugins`): CMF,
 *     at `plugins/product-design/kit.json`, tagged `product-design-v<version>`.
 *     CMF moved there from Loop Studio Design on 2026-09-29, and Vesper reads CMF
 *     from this kit only.
 * Each kit is read at its newest tag (or at the ref its env names, for a preview
 * or a rollback) and never by parsing the repository's markdown. The contract is
 * `docs/kit.md` in each repository.
 *
 * Before a kit is used:
 *   1. its `plugin.json` at the same commit has the kit's version;
 *   2. it validates against its plugin's schema (`./kit-schema.ts`), and `schema` is 1;
 *   3. `kit/conformance.json` has the sha256 the kit names, and its result-rule
 *      vectors (`ladder` in the studio kit, `results` in the product kit) and
 *      comment-line vectors reproduce here (`./conformance.ts`).
 * A kit that fails any of these is stored as invalid and the last good kit of
 * the same plugin stays in use, marked stale. A failed fetch does the same. One
 * plugin's kit is never the other's fallback.
 *
 * Caching, per plugin: 60 seconds in memory; per kit blob sha in `creative_kits`;
 * each file the kit names, per blob sha, in `creative_kit_files`, checked against
 * the sha256 the kit gives it.
 */

import crypto from 'crypto'
import type { z } from 'zod'
import { ConformanceSchema, KitSchema, ProductKitSchema, type AnyKit, type Conformance, type Kit, type ProductKit } from './kit-schema'
import { runConformance } from './conformance'

export const KIT_PATH = 'plugins/studio-design/kit.json'
export const PLUGIN_JSON_PATH = 'plugins/studio-design/.claude-plugin/plugin.json'
export const PLUGIN_ROOT = 'plugins/studio-design/'
export const TAG_PREFIX = 'studio-design-v'
export const MEMORY_TTL_MS = 60_000

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

// ------------------------------------------------------------------ which kit

/** One plugin's kit: its name, the schema it must pass and what a message calls it. */
export interface KitDescriptor<K extends AnyKit = AnyKit> {
  plugin: K['plugin']
  /** How a message names it: 'creative kit', 'product kit'. */
  label: string
  schema: z.ZodType<K, z.ZodTypeDef, unknown>
}

export const STUDIO_KIT: KitDescriptor<Kit> = { plugin: 'studio-design', label: 'creative kit', schema: KitSchema }
export const PRODUCT_KIT: KitDescriptor<ProductKit> = { plugin: 'product-design', label: 'product kit', schema: ProductKitSchema }

/** Where a plugin's kit sits in its repository, and what its release tags start with. */
export function kitPaths(plugin: string) {
  const root = `plugins/${plugin}/`
  return {
    root,
    kit: `${root}kit.json`,
    pluginJson: `${root}.claude-plugin/plugin.json`,
    conformance: `${root}kit/conformance.json`,
    tagPrefix: `${plugin}-v`,
  }
}

/**
 * A path as the kit writes it, as a path in the repository: one starting `skills/` or `kit/` is
 * inside the kit's own plugin folder (`pluginRoot`, the studio kit's unless named); anything else
 * (`products/`, `workstreams/`, `.github/`) is a repository path.
 */
export function repoPathOf(kitPath: string, pluginRoot: string = PLUGIN_ROOT): string {
  return kitPath.startsWith('skills/') || kitPath.startsWith('kit/') ? `${pluginRoot}${kitPath}` : kitPath
}

// ------------------------------------------------------------------ what the kit is read from

export interface KitRef {
  /** The tag or ref asked for, e.g. `studio-design-v0.3.0` or a branch. */
  ref: string
  commit: string
}

export interface KitSourceFile {
  blobSha: string
  bytes: Buffer
}

/** The GitHub side, injected so the tests run on fixtures. */
export interface KitSource {
  /** The newest release tag of the kit's plugin, or `ref` when given, as a commit. */
  resolve(ref: string | null): Promise<KitRef>
  /** A file at a commit, or null when the commit has no such file. */
  getFile(path: string, commit: string): Promise<KitSourceFile | null>
}

// ------------------------------------------------------------------ where kits are kept

export interface StoredKit {
  blobSha: string
  commitSha: string
  ref: string
  version: string
  schema: number
  valid: boolean
  error: string | null
  kit: AnyKit | null
  conformance: Conformance | null
  sizeBytes: number
  fetchedAt: Date
}

export interface KitStore {
  getByBlob(blobSha: string): Promise<StoredKit | null>
  /** The newest valid kit of that plugin (`kit.plugin`); every plugin's when none is named. */
  latestValid(plugin?: string): Promise<StoredKit | null>
  save(kit: StoredKit): Promise<void>
  getFile(blobSha: string): Promise<{ sha256: string; content: Buffer } | null>
  saveFile(file: { blobSha: string; path: string; commitSha: string; sha256: string; content: Buffer }): Promise<void>
}

export interface LoadedKit<K extends AnyKit = Kit> {
  kit: K
  conformance: Conformance
  ref: string
  commit: string
  blobSha: string
  fetchedAt: Date
  /** True when the newest kit could not be read or was refused, and this is the last good one. */
  stale: boolean
  /** Why it is stale, when it is. */
  staleReason: string | null
}

// ------------------------------------------------------------------ validation, pure

export interface KitCheck<K extends AnyKit = Kit> {
  ok: boolean
  kit: K | null
  conformance: Conformance | null
  problems: string[]
}

/**
 * Every check a kit must pass before it is used, on the bytes of the three files, against the
 * schema of the plugin it is read as (the studio kit's unless named).
 */
export function checkKit<K extends AnyKit = Kit>(
  kitBytes: Buffer,
  pluginJsonBytes: Buffer | null,
  conformanceBytes: Buffer | null,
  desc: KitDescriptor<K> = STUDIO_KIT as unknown as KitDescriptor<K>
): KitCheck<K> {
  const problems: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(kitBytes.toString('utf8'))
  } catch {
    return { ok: false, kit: null, conformance: null, problems: ['kit.json is not JSON'] }
  }
  const schemaNumber = (raw as { schema?: unknown })?.schema
  if (schemaNumber !== 1) {
    return {
      ok: false,
      kit: null,
      conformance: null,
      problems: [`kit.json is schema ${JSON.stringify(schemaNumber)}; this Vesper reads schema 1`],
    }
  }
  const parsed = desc.schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      kit: null,
      conformance: null,
      problems: parsed.error.issues.slice(0, 8).map((i) => `kit.json ${i.path.join('.')}: ${i.message}`),
    }
  }
  const kit = parsed.data

  if (!pluginJsonBytes) {
    problems.push('plugin.json is missing at the kit commit')
  } else {
    try {
      const version = (JSON.parse(pluginJsonBytes.toString('utf8')) as { version?: string }).version
      if (version !== kit.version) problems.push(`plugin.json says ${version}, kit.json says ${kit.version}`)
    } catch {
      problems.push('plugin.json is not JSON')
    }
  }

  let conformance: Conformance | null = null
  if (!conformanceBytes) {
    problems.push(`${kit.conformance.path} is missing at the kit commit`)
  } else if (sha256Hex(conformanceBytes) !== kit.conformance.sha256) {
    problems.push(`${kit.conformance.path} does not have the sha256 the kit names`)
  } else {
    const c = ConformanceSchema.safeParse(JSON.parse(conformanceBytes.toString('utf8')))
    if (!c.success) {
      problems.push(...c.error.issues.slice(0, 5).map((i) => `conformance.json ${i.path.join('.')}: ${i.message}`))
    } else {
      conformance = c.data
      problems.push(...runConformance(kit, conformance))
    }
  }
  return { ok: problems.length === 0, kit, conformance, problems }
}

// ------------------------------------------------------------------ loading

export interface KitLoaderDeps<K extends AnyKit = Kit> {
  source: KitSource
  store: KitStore
  /** The ref its env names (`CREATIVE_KIT_REF`, `PRODUCT_KIT_REF`), when set. */
  ref?: string | null
  now?: () => number
  /** Which kit; the studio kit when not given. */
  kit?: KitDescriptor<K>
}

interface MemoryEntry {
  loaded: LoadedKit<AnyKit>
  atMs: number
}

const memory = new Map<string, MemoryEntry>()

/** Drop the in-memory kit of one plugin, or of every plugin (tests; the admin refresh). */
export function clearKitMemory(plugin?: string): void {
  if (plugin) memory.delete(plugin)
  else memory.clear()
}

function fromStored<K extends AnyKit>(stored: StoredKit, stale: boolean, staleReason: string | null): LoadedKit<K> {
  return {
    kit: stored.kit as K,
    conformance: stored.conformance as Conformance,
    ref: stored.ref,
    commit: stored.commitSha,
    blobSha: stored.blobSha,
    fetchedAt: stored.fetchedAt,
    stale,
    staleReason,
  }
}

async function fallback<K extends AnyKit>(store: KitStore, desc: KitDescriptor<K>, reason: string): Promise<LoadedKit<K>> {
  const last = await store.latestValid(desc.plugin)
  // Checked here too: a kit of the other plugin is never this one's fallback.
  if (!last || !last.kit || last.kit.plugin !== desc.plugin) throw new Error(`No ${desc.label} is available: ${reason}`)
  return fromStored<K>(last, true, reason)
}

/** The kit to use now: the newest good one of its plugin, or that plugin's last good one marked stale. */
export async function loadCreativeKit<K extends AnyKit = Kit>(deps: KitLoaderDeps<K>, opts: { force?: boolean } = {}): Promise<LoadedKit<K>> {
  const desc = deps.kit ?? (STUDIO_KIT as unknown as KitDescriptor<K>)
  const now = deps.now ?? Date.now
  const hit = memory.get(desc.plugin)
  if (!opts.force && hit && now() - hit.atMs < MEMORY_TTL_MS) return hit.loaded as LoadedKit<K>

  let loaded: LoadedKit<K>
  try {
    loaded = await loadFresh(deps, desc, now)
  } catch (err) {
    loaded = await fallback(deps.store, desc, `the kit could not be read (${(err as Error).message})`)
  }
  memory.set(desc.plugin, { loaded, atMs: now() })
  return loaded
}

async function loadFresh<K extends AnyKit>(deps: KitLoaderDeps<K>, desc: KitDescriptor<K>, now: () => number): Promise<LoadedKit<K>> {
  const { source, store } = deps
  const paths = kitPaths(desc.plugin)
  const ref = await source.resolve(deps.ref ?? null)
  const kitFile = await source.getFile(paths.kit, ref.commit)
  if (!kitFile) throw new Error(`${ref.ref} has no ${paths.kit}`)

  const known = await store.getByBlob(kitFile.blobSha)
  if (known?.valid && known.kit && known.conformance && known.kit.plugin === desc.plugin) {
    return { ...fromStored<K>(known, false, null), ref: ref.ref, commit: ref.commit }
  }
  if (known && !known.valid) {
    return fallback(store, desc, `the kit at ${ref.ref} was refused: ${known.error}`)
  }

  const [pluginJson, conformanceFile] = await Promise.all([
    source.getFile(paths.pluginJson, ref.commit),
    source.getFile(paths.conformance, ref.commit),
  ])
  const check = checkKit(kitFile.bytes, pluginJson?.bytes ?? null, conformanceFile?.bytes ?? null, desc)
  const stored: StoredKit = {
    blobSha: kitFile.blobSha,
    commitSha: ref.commit,
    ref: ref.ref,
    version: check.kit?.version ?? 'unknown',
    schema: Number((check.kit as { schema?: number } | null)?.schema ?? 0),
    valid: check.ok,
    error: check.ok ? null : check.problems.join('; '),
    kit: check.kit,
    conformance: check.conformance,
    sizeBytes: kitFile.bytes.length,
    fetchedAt: new Date(now()),
  }
  await store.save(stored)
  if (!check.ok) return fallback(store, desc, `the kit at ${ref.ref} was refused: ${stored.error}`)
  return fromStored<K>(stored, false, null)
}

/**
 * A file the kit names, at the kit's commit, checked against the sha256 the
 * kit gives it. A `skills/` or `kit/` path is read inside the kit's own plugin
 * folder (the studio kit's when the kit is not given). Cached per blob sha.
 * Throws when the bytes differ.
 */
export async function getKitFile(
  loaded: Pick<LoadedKit<AnyKit>, 'commit'> & { kit?: Pick<AnyKit, 'plugin'> },
  file: { path: string; sha256: string },
  deps: Pick<KitLoaderDeps<AnyKit>, 'source' | 'store'>
): Promise<Buffer> {
  const repoPath = repoPathOf(file.path, loaded.kit ? kitPaths(loaded.kit.plugin).root : PLUGIN_ROOT)
  const fetched = await deps.source.getFile(repoPath, loaded.commit)
  if (!fetched) throw new Error(`${repoPath} is not at ${loaded.commit.slice(0, 7)}`)
  const cached = await deps.store.getFile(fetched.blobSha)
  if (cached && cached.sha256 === file.sha256) return cached.content
  const digest = sha256Hex(fetched.bytes)
  if (digest !== file.sha256) {
    throw new Error(`${repoPath} at ${loaded.commit.slice(0, 7)} does not have the sha256 the kit names`)
  }
  await deps.store.saveFile({ blobSha: fetched.blobSha, path: repoPath, commitSha: loaded.commit, sha256: digest, content: fetched.bytes })
  return fetched.bytes
}

// ------------------------------------------------------------------ tags

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `[major, minor, patch]` of a `<prefix>X.Y.Z` tag (the studio kit's prefix unless named), else null. */
export function parseTagVersion(ref: string, prefix: string = TAG_PREFIX): number[] | null {
  const m = new RegExp(`^(?:refs/tags/)?${escapeRegExp(prefix)}(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(ref)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The newest `<prefix>X.Y.Z` among refs, by version number (not by name or date). */
export function newestTag(refs: readonly string[], prefix: string = TAG_PREFIX): string | null {
  let best: { ref: string; v: number[] } | null = null
  for (const ref of refs) {
    const v = parseTagVersion(ref, prefix)
    if (!v) continue
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) {
      best = { ref, v }
    }
  }
  return best ? best.ref.replace(/^refs\/tags\//, '') : null
}
