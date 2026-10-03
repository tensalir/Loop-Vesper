/**
 * The Loop kits: what Vesper reads from the plugin repositories.
 *
 * Two plugins publish a kit, each from its own repository, in the same shape
 * (`./kit-schema.ts`). Loop is renaming both, so each is read under its new name
 * and its old one (`plugins/<name>/kit.json`, tags `<name>-v<version>`):
 *   - `ai-studio-design`, until the rename `studio-design` (Loop AI Studio Design,
 *     `tensalir/loop-ai-studio`): Eclipse, packaging and the prompting skill. Its
 *     builder writes `plugins/<name>/kit.json` and `plugins/<name>/kit/conformance.json`;
 *     a merge that raises the plugin's version is tagged `<name>-v<version>` (the
 *     plugin was `creative`, tagged `creative-v*`, until 2026-09-28; those tags are
 *     no longer read, and a kit still naming `creative` is refused).
 *   - `ai-product-design`, until the rename `product-design` (Loop AI Product Design,
 *     `tensalir/loop-ai-product`, until the rename `tensalir/loop-product-plugins`):
 *     CMF, at `plugins/<name>/kit.json`, tagged `<name>-v<version>`. CMF moved there
 *     from Loop Studio Design on 2026-09-29, and Vesper reads CMF from this kit only.
 * Each kit is read at its newest tag under either name, by version (so the first
 * `ai-*` tag takes over from the last old-named one, and with only old-named tags the
 * old kit is served), or at the ref its env names, for a preview or a rollback, from
 * the new name's folder when that ref has it and the old name's otherwise. Never by
 * parsing the repository's markdown. The contract is `docs/kit.md` in each repository.
 *
 * Before a kit is used:
 *   1. its `plugin.json` at the same commit has the kit's version;
 *   2. it validates against its plugin's schema (`./kit-schema.ts`), and `schema` is 1;
 *   3. `kit/conformance.json` has the sha256 the kit names, and its result-rule
 *      vectors (`ladder` in the studio kit, `results` in the product kit) and
 *      comment-line vectors reproduce here (`./conformance.ts`).
 * A kit that fails any of these is stored as invalid and the last good kit of
 * the same plugin, under either of its names, stays in use, marked stale. A failed
 * fetch does the same. One plugin's kit is never the other's fallback.
 *
 * Caching, per kit (whatever its plugin is called): 60 seconds in memory; per kit
 * blob sha in `creative_kits`;
 * each file the kit names, per blob sha, in `creative_kit_files`, checked against
 * the sha256 the kit gives it.
 */

import crypto from 'crypto'
import type { z } from 'zod'
import {
  ConformanceSchema,
  KitSchema,
  PRODUCT_PLUGINS,
  ProductKitSchema,
  STUDIO_PLUGINS,
  type AnyKit,
  type Conformance,
  type Kit,
  type ProductKit,
} from './kit-schema'
import { runConformance } from './conformance'

/**
 * The folder a `skills/` or `kit/` path is read in when no kit is named: the studio kit's under the
 * name its released kits carry until the first `ai-studio-design` release. A loaded kit always reads
 * inside its own plugin's folder (`kitPaths(kit.plugin).root`).
 */
export const PLUGIN_ROOT = 'plugins/studio-design/'
/** The studio kit's release tags, under each of its plugin's names, the current one first. */
export const STUDIO_TAG_PREFIXES: readonly string[] = STUDIO_PLUGINS.map((p) => `${p}-v`)
export const MEMORY_TTL_MS = 60_000

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

// ------------------------------------------------------------------ which kit

/** One plugin's kit: which kit it is, the names its plugin is published under, the schema it must pass and what a message calls it. */
export interface KitDescriptor<K extends AnyKit = AnyKit> {
  /** Which kit, whatever its plugin is called now: what it is kept under in memory. */
  id: 'studio' | 'product'
  /**
   * Every name the plugin is published under, the current one first: a kit is read from
   * `plugins/<name>/` at a `<name>-v*` tag of any of them, and its `plugin` must be one of them.
   */
  plugins: readonly K['plugin'][]
  /** How a message names it: 'creative kit', 'product kit'. */
  label: string
  schema: z.ZodType<K, z.ZodTypeDef, unknown>
}

export const STUDIO_KIT: KitDescriptor<Kit> = { id: 'studio', plugins: STUDIO_PLUGINS, label: 'creative kit', schema: KitSchema }
export const PRODUCT_KIT: KitDescriptor<ProductKit> = { id: 'product', plugins: PRODUCT_PLUGINS, label: 'product kit', schema: ProductKitSchema }

/** Whether this kit's plugin is published under that name. */
export function acceptsPlugin(desc: Pick<KitDescriptor, 'plugins'>, plugin: string | null | undefined): boolean {
  return !!plugin && (desc.plugins as readonly string[]).includes(plugin)
}

/** The release-tag prefixes of a kit, one per name of its plugin, in the same order. */
export function tagPrefixes(desc: Pick<KitDescriptor, 'plugins'>): string[] {
  return desc.plugins.map((p) => kitPaths(p).tagPrefix)
}

/** The plugin name a `<name>-vX.Y.Z` tag is of, among these names; null for a branch, a commit or any other tag. */
export function pluginOfTag(ref: string, plugins: readonly string[]): string | null {
  return plugins.find((p) => parseTagVersion(ref, kitPaths(p).tagPrefix) !== null) ?? null
}

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
  /** The tag or ref asked for, e.g. `ai-studio-design-v0.7.0`, `studio-design-v0.6.1` or a branch. */
  ref: string
  commit: string
}

export interface KitSourceFile {
  blobSha: string
  bytes: Buffer
}

/** The GitHub side, injected so the tests run on fixtures. */
export interface KitSource {
  /**
   * `ref` when given, else the newest release tag among `tagPrefixes` (every name of the kit's
   * plugin; the source's own when not given), by version across all of them, as a commit.
   */
  resolve(ref: string | null, tagPrefixes?: readonly string[]): Promise<KitRef>
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
  /**
   * The newest valid kit whose `kit.plugin` is that name, or any of those names (one plugin's old
   * and new names); every plugin's when none is named.
   */
  latestValid(plugin?: string | readonly string[]): Promise<StoredKit | null>
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
 * schema of the plugin it is read as (the studio kit's unless named). `folder`, the plugin name
 * whose `plugins/<name>/` folder the kit was read from, must be the name the kit gives itself,
 * so the files it names are read where it sits.
 */
export function checkKit<K extends AnyKit = Kit>(
  kitBytes: Buffer,
  pluginJsonBytes: Buffer | null,
  conformanceBytes: Buffer | null,
  desc: KitDescriptor<K> = STUDIO_KIT as unknown as KitDescriptor<K>,
  folder?: string
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
  if (folder && kit.plugin !== folder) {
    problems.push(`kit.json at ${kitPaths(folder).kit} names the plugin ${kit.plugin}`)
  }

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

/** Kept per kit (`KitDescriptor.id`), never per plugin name: a rename does not split it. */
const memory = new Map<string, MemoryEntry>()

/** Drop the in-memory copy of one kit (`'studio'`, `'product'`), or of both (tests; the admin refresh). */
export function clearKitMemory(kit?: KitDescriptor['id']): void {
  if (kit) memory.delete(kit)
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
  // The last good kit under any of the plugin's names: an old-named kit is the new name's fallback.
  const last = await store.latestValid(desc.plugins)
  // Checked here too: a kit of the other plugin is never this one's fallback.
  if (!last || !last.kit || !acceptsPlugin(desc, last.kit.plugin)) throw new Error(`No ${desc.label} is available: ${reason}`)
  return fromStored<K>(last, true, reason)
}

/** The kit to use now: the newest good one of its plugin, or that plugin's last good one marked stale. */
export async function loadCreativeKit<K extends AnyKit = Kit>(deps: KitLoaderDeps<K>, opts: { force?: boolean } = {}): Promise<LoadedKit<K>> {
  const desc = deps.kit ?? (STUDIO_KIT as unknown as KitDescriptor<K>)
  const now = deps.now ?? Date.now
  const hit = memory.get(desc.id)
  if (!opts.force && hit && now() - hit.atMs < MEMORY_TTL_MS) return hit.loaded as LoadedKit<K>

  let loaded: LoadedKit<K>
  try {
    loaded = await loadFresh(deps, desc, now)
  } catch (err) {
    loaded = await fallback(deps.store, desc, `the kit could not be read (${(err as Error).message})`)
  }
  memory.set(desc.id, { loaded, atMs: now() })
  return loaded
}

/**
 * The folders a kit is looked for in at a ref, in order: at its newest release tag (under any name
 * of the plugin), the folder of the name that tag carries; at a ref the env names (a branch, a
 * commit or a tag), the current name's and then the older one's.
 */
function foldersAt(ref: string, explicit: boolean, plugins: readonly string[]): readonly string[] {
  const named = explicit ? null : pluginOfTag(ref, plugins)
  return named ? [named] : plugins
}

async function loadFresh<K extends AnyKit>(deps: KitLoaderDeps<K>, desc: KitDescriptor<K>, now: () => number): Promise<LoadedKit<K>> {
  const { source, store } = deps
  const explicit = !!deps.ref
  const ref = await source.resolve(deps.ref ?? null, tagPrefixes(desc))
  const folders = foldersAt(ref.ref, explicit, desc.plugins)
  let plugin: string | null = null
  let kitFile: KitSourceFile | null = null
  for (const name of folders) {
    kitFile = await source.getFile(kitPaths(name).kit, ref.commit)
    if (kitFile) {
      plugin = name
      break
    }
  }
  if (!kitFile || !plugin) throw new Error(`${ref.ref} has no ${folders.map((name) => kitPaths(name).kit).join(' or ')}`)
  const paths = kitPaths(plugin)

  const known = await store.getByBlob(kitFile.blobSha)
  // `plugin` is one of this kit's names, so a kit known under it is never the other plugin's.
  if (known?.valid && known.kit && known.conformance && known.kit.plugin === plugin) {
    return { ...fromStored<K>(known, false, null), ref: ref.ref, commit: ref.commit }
  }
  if (known && !known.valid) {
    return fallback(store, desc, `the kit at ${ref.ref} was refused: ${known.error}`)
  }

  const [pluginJson, conformanceFile] = await Promise.all([
    source.getFile(paths.pluginJson, ref.commit),
    source.getFile(paths.conformance, ref.commit),
  ])
  const check = checkKit(kitFile.bytes, pluginJson?.bytes ?? null, conformanceFile?.bytes ?? null, desc, plugin)
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

/** `[major, minor, patch]` of a `<prefix>X.Y.Z` tag (the studio kit's current prefix unless named), else null. */
export function parseTagVersion(ref: string, prefix: string = STUDIO_TAG_PREFIXES[0]): number[] | null {
  const m = new RegExp(`^(?:refs/tags/)?${escapeRegExp(prefix)}(\\d+)\\.(\\d+)\\.(\\d+)$`).exec(ref)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * The newest `<prefix>X.Y.Z` among refs, by version number (not by name or date), across every
 * prefix given (the studio kit's, under each of its plugin's names, unless named). On the same
 * version the earlier prefix, the plugin's current name, wins.
 */
export function newestTag(refs: readonly string[], prefixes: string | readonly string[] = STUDIO_TAG_PREFIXES): string | null {
  let best: { ref: string; v: number[] } | null = null
  for (const prefix of typeof prefixes === 'string' ? [prefixes] : prefixes) {
    for (const ref of refs) {
      const v = parseTagVersion(ref, prefix)
      if (!v) continue
      if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) {
        best = { ref, v }
      }
    }
  }
  return best ? best.ref.replace(/^refs\/tags\//, '') : null
}
