/**
 * A kit's source: its plugin repository on GitHub, read through Vesper's
 * GitHub App. The studio kit's tags start `ai-studio-design-v` (until the rename
 * `studio-design-v`), the product kit's `ai-product-design-v` (until the rename
 * `product-design-v`); every prefix is listed and the newest version across them wins.
 *
 * A repository Loop renames (the product kit's, `tensalir/loop-product-plugins` to
 * `tensalir/loop-ai-product`) is read through `firstReachableKitSource`: its names
 * newest first, the first that answers is the one read.
 */

import type { Gh } from '@/lib/github/rest'
import { newestTag, STUDIO_TAG_PREFIXES, type KitRef, type KitSource, type KitSourceFile } from './kit'

interface MatchingRef {
  ref: string
  object: { sha: string; type: 'commit' | 'tag' }
}

interface ContentsFile {
  type: string
  sha: string
  size: number
  content?: string
  encoding?: string
}

/** The repository answered, and has no kit release tag, or not the ref asked for. */
export class KitNotInRepo extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KitNotInRepo'
  }
}

function prefixList(prefixes: string | readonly string[]): readonly string[] {
  return typeof prefixes === 'string' ? [prefixes] : prefixes
}

/** `ai-studio-design-v* or studio-design-v*`, as a message names the tags it looked for. */
export function tagsWording(prefixes: string | readonly string[]): string {
  return prefixList(prefixes)
    .map((p) => `${p}*`)
    .join(' or ')
}

export function githubKitSource(gh: Gh, repo: string, defaultPrefixes: string | readonly string[] = STUDIO_TAG_PREFIXES): KitSource {
  // One listing per prefix: `matching-refs` matches by prefix, so `studio-design-v` never lists
  // `ai-studio-design-v*` tags, and each name is asked for on its own.
  const refsCache = new Map<string, { etag: string | null; refs: MatchingRef[] }>()

  async function listTags(prefix: string): Promise<MatchingRef[]> {
    const cached = refsCache.get(prefix)
    const res = await gh(`/repos/${repo}/git/matching-refs/tags/${prefix}`, { etag: cached?.etag })
    if (res.status === 304 && cached) return cached.refs
    if (res.status === 404) return []
    const refs = res.json<MatchingRef[]>()
    refsCache.set(prefix, { etag: res.etag, refs })
    return refs
  }

  return {
    async resolve(ref: string | null, tagPrefixes?: readonly string[]): Promise<KitRef> {
      if (ref) {
        const res = await gh(`/repos/${repo}/commits/${encodeURIComponent(ref)}`)
        if (res.status === 404) throw new KitNotInRepo(`${repo} has no ref ${ref}`)
        return { ref, commit: res.json<{ sha: string }>().sha }
      }
      const prefixes = prefixList(tagPrefixes?.length ? tagPrefixes : defaultPrefixes)
      const refs = (await Promise.all(prefixes.map(listTags))).flat()
      const tag = newestTag(
        refs.map((r) => r.ref),
        prefixes
      )
      if (!tag) throw new KitNotInRepo(`${repo} has no ${tagsWording(prefixes)} tag yet`)
      const entry = refs.find((r) => r.ref === `refs/tags/${tag}`)!
      if (entry.object.type === 'tag') {
        // An annotated tag points at a tag object, which points at the commit.
        const res = await gh(`/repos/${repo}/git/tags/${entry.object.sha}`)
        return { ref: tag, commit: res.json<{ object: { sha: string } }>().object.sha }
      }
      return { ref: tag, commit: entry.object.sha }
    },

    async getFile(path: string, commit: string): Promise<KitSourceFile | null> {
      const url = `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`
      const res = await gh(url)
      if (res.status === 404) return null
      const meta = res.json<ContentsFile>()
      if (meta.type !== 'file') throw new Error(`${path} at ${commit.slice(0, 7)} is not a file`)
      if (meta.encoding === 'base64' && meta.content && meta.size > 0) {
        return { blobSha: meta.sha, bytes: Buffer.from(meta.content, 'base64') }
      }
      // Over 1 MB the JSON form carries no content; the raw form carries up to 100 MB.
      const raw = await gh(url, { accept: 'application/vnd.github.raw' })
      return { blobSha: meta.sha, bytes: raw.bytes }
    },
  }
}

// ------------------------------------------------------------------ a repository under two names

/**
 * Whether an error says the kit is not under this repository name, so the next name is worth
 * asking: GitHub refused a token for the name or answered 404/422 (the repository is not there or
 * not in the App's installation), or the repository has no kit tag or not the ref. Anything else
 * (a 5xx, the network) is not: it is thrown, and the last good kit is served stale.
 */
export function isRepoMiss(err: unknown): boolean {
  if (err instanceof KitNotInRepo) return true
  const status = (err as { status?: unknown } | null)?.status
  return status === 404 || status === 422
}

export interface RepoCandidate {
  repo: string
  source: KitSource
}

/** How long a name that answered is asked first, before the newest name is tried first again. */
export const REPO_CHOICE_TTL_MS = 10 * 60_000

/** The name that answered, per list of names, so a read does not ask a missing name every time. */
const chosenRepo = new Map<string, { repo: string; atMs: number }>()

/** Forget which name answered (tests). */
export function clearRepoChoice(): void {
  chosenRepo.clear()
}

/**
 * One repository known under several names, newest first (`tensalir/loop-ai-product`, then
 * `tensalir/loop-product-plugins`): each call goes to the first name that answers, the name that
 * answered last asked first for ten minutes. A file a reachable name does not have is null, as it
 * would be from that repository alone; only a miss (`isRepoMiss`) moves on to the next name.
 */
export function firstReachableKitSource(candidates: readonly RepoCandidate[], opts: { now?: () => number } = {}): KitSource {
  if (!candidates.length) throw new Error('firstReachableKitSource needs at least one repository')
  const now = opts.now ?? Date.now
  const key = candidates.map((c) => c.repo).join(' ')

  function order(): readonly RepoCandidate[] {
    const chosen = chosenRepo.get(key)
    if (!chosen || now() - chosen.atMs >= REPO_CHOICE_TTL_MS) return candidates
    const first = candidates.find((c) => c.repo === chosen.repo)
    return first ? [first, ...candidates.filter((c) => c !== first)] : candidates
  }

  async function firstAnswer<T>(ask: (source: KitSource) => Promise<T>): Promise<T> {
    const misses: string[] = []
    let lastMiss: unknown = null
    for (const c of order()) {
      try {
        const answer = await ask(c.source)
        chosenRepo.set(key, { repo: c.repo, atMs: now() })
        return answer
      } catch (err) {
        if (!isRepoMiss(err)) throw err
        lastMiss = err
        misses.push(`${c.repo}: ${(err as Error).message}`)
      }
    }
    if (candidates.length === 1) throw lastMiss
    throw new KitNotInRepo(`none of ${candidates.map((c) => c.repo).join(', ')} has it (${misses.join('; ')})`)
  }

  return {
    resolve: (ref, tagPrefixes) => firstAnswer((s) => s.resolve(ref, tagPrefixes)),
    getFile: (path, commit) => firstAnswer((s) => s.getFile(path, commit)),
  }
}
