/**
 * The creative kit: what Vesper reads from the plugin repository.
 *
 * The Loop Creative plugin's builder writes `plugins/creative/kit.json` and
 * `plugins/creative/kit/conformance.json`; a merge that raises the plugin's
 * version is tagged `creative-v<version>`. Vesper reads the kit at the newest
 * such tag (or at `CREATIVE_KIT_REF`, for a preview or a rollback) and never
 * parses the repository's markdown. The contract is `docs/kit.md` there.
 *
 * Before a kit is used:
 *   1. its `plugin.json` at the same commit has the kit's version;
 *   2. it validates (`./kit-schema.ts`), and `schema` is 1;
 *   3. `kit/conformance.json` has the sha256 the kit names, and its ladder and
 *      comment-line vectors reproduce here (`./conformance.ts`).
 * A kit that fails any of these is stored as invalid and the last good kit
 * stays in use, marked stale. A failed fetch does the same.
 *
 * Caching: 60 seconds in memory; per kit blob sha in `creative_kits`; each
 * file the kit names, per blob sha, in `creative_kit_files`, checked against
 * the sha256 the kit gives it.
 */

import crypto from 'crypto'
import { ConformanceSchema, KitSchema, type Conformance, type Kit } from './kit-schema'
import { runConformance } from './conformance'

export const KIT_PATH = 'plugins/creative/kit.json'
export const PLUGIN_JSON_PATH = 'plugins/creative/.claude-plugin/plugin.json'
export const PLUGIN_ROOT = 'plugins/creative/'
export const TAG_PREFIX = 'creative-v'
export const MEMORY_TTL_MS = 60_000

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** A path as the kit writes it, as a path in the repository. */
export function repoPathOf(kitPath: string): string {
  return kitPath.startsWith('skills/') || kitPath.startsWith('kit/') ? `${PLUGIN_ROOT}${kitPath}` : kitPath
}

// ------------------------------------------------------------------ what the kit is read from

export interface KitRef {
  /** The tag or ref asked for, e.g. `creative-v0.2.0` or a branch. */
  ref: string
  commit: string
}

export interface KitSourceFile {
  blobSha: string
  bytes: Buffer
}

/** The GitHub side, injected so the tests run on fixtures. */
export interface KitSource {
  /** The newest `creative-v*` tag, or `ref` when given, as a commit. */
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
  kit: Kit | null
  conformance: Conformance | null
  sizeBytes: number
  fetchedAt: Date
}

export interface KitStore {
  getByBlob(blobSha: string): Promise<StoredKit | null>
  latestValid(): Promise<StoredKit | null>
  save(kit: StoredKit): Promise<void>
  getFile(blobSha: string): Promise<{ sha256: string; content: Buffer } | null>
  saveFile(file: { blobSha: string; path: string; commitSha: string; sha256: string; content: Buffer }): Promise<void>
}

export interface LoadedKit {
  kit: Kit
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

export interface KitCheck {
  ok: boolean
  kit: Kit | null
  conformance: Conformance | null
  problems: string[]
}

/** Every check a kit must pass before it is used, on the bytes of the three files. */
export function checkKit(kitBytes: Buffer, pluginJsonBytes: Buffer | null, conformanceBytes: Buffer | null): KitCheck {
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
  const parsed = KitSchema.safeParse(raw)
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

export interface KitLoaderDeps {
  source: KitSource
  store: KitStore
  /** `CREATIVE_KIT_REF`, when set. */
  ref?: string | null
  now?: () => number
}

interface MemoryEntry {
  loaded: LoadedKit
  atMs: number
}

let memory: MemoryEntry | null = null

/** Drop the in-memory kit (tests; the admin refresh). */
export function clearKitMemory(): void {
  memory = null
}

function fromStored(stored: StoredKit, stale: boolean, staleReason: string | null): LoadedKit {
  return {
    kit: stored.kit as Kit,
    conformance: stored.conformance as Conformance,
    ref: stored.ref,
    commit: stored.commitSha,
    blobSha: stored.blobSha,
    fetchedAt: stored.fetchedAt,
    stale,
    staleReason,
  }
}

async function fallback(store: KitStore, reason: string): Promise<LoadedKit> {
  const last = await store.latestValid()
  if (!last) throw new Error(`No creative kit is available: ${reason}`)
  return fromStored(last, true, reason)
}

/** The kit to use now: the newest good one, or the last good one marked stale. */
export async function loadCreativeKit(deps: KitLoaderDeps, opts: { force?: boolean } = {}): Promise<LoadedKit> {
  const now = deps.now ?? Date.now
  if (!opts.force && memory && now() - memory.atMs < MEMORY_TTL_MS) return memory.loaded

  let loaded: LoadedKit
  try {
    loaded = await loadFresh(deps, now)
  } catch (err) {
    loaded = await fallback(deps.store, `the kit could not be read (${(err as Error).message})`)
  }
  memory = { loaded, atMs: now() }
  return loaded
}

async function loadFresh(deps: KitLoaderDeps, now: () => number): Promise<LoadedKit> {
  const { source, store } = deps
  const ref = await source.resolve(deps.ref ?? null)
  const kitFile = await source.getFile(KIT_PATH, ref.commit)
  if (!kitFile) throw new Error(`${ref.ref} has no ${KIT_PATH}`)

  const known = await store.getByBlob(kitFile.blobSha)
  if (known?.valid && known.kit && known.conformance) {
    return { ...fromStored(known, false, null), ref: ref.ref, commit: ref.commit }
  }
  if (known && !known.valid) {
    return fallback(store, `the kit at ${ref.ref} was refused: ${known.error}`)
  }

  const [pluginJson, conformanceFile] = await Promise.all([
    source.getFile(PLUGIN_JSON_PATH, ref.commit),
    source.getFile(`${PLUGIN_ROOT}kit/conformance.json`, ref.commit),
  ])
  const check = checkKit(kitFile.bytes, pluginJson?.bytes ?? null, conformanceFile?.bytes ?? null)
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
  if (!check.ok) return fallback(store, `the kit at ${ref.ref} was refused: ${stored.error}`)
  return fromStored(stored, false, null)
}

/**
 * A file the kit names, at the kit's commit, checked against the sha256 the
 * kit gives it. Cached per blob sha. Throws when the bytes differ.
 */
export async function getKitFile(
  loaded: Pick<LoadedKit, 'commit'>,
  file: { path: string; sha256: string },
  deps: Pick<KitLoaderDeps, 'source' | 'store'>
): Promise<Buffer> {
  const repoPath = repoPathOf(file.path)
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

export function parseTagVersion(ref: string): number[] | null {
  const m = /^(?:refs\/tags\/)?creative-v(\d+)\.(\d+)\.(\d+)$/.exec(ref)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The newest `creative-vX.Y.Z` among refs, by version number (not by name or date). */
export function newestTag(refs: readonly string[]): string | null {
  let best: { ref: string; v: number[] } | null = null
  for (const ref of refs) {
    const v = parseTagVersion(ref)
    if (!v) continue
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) {
      best = { ref, v }
    }
  }
  return best ? best.ref.replace(/^refs\/tags\//, '') : null
}
