/**
 * A kit's source: its plugin repository on GitHub, read through Vesper's
 * GitHub App. The studio kit's tags start `studio-design-v`, the product kit's
 * `product-design-v`.
 */

import type { Gh } from '@/lib/github/rest'
import { newestTag, TAG_PREFIX, type KitRef, type KitSource, type KitSourceFile } from './kit'

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

export function githubKitSource(gh: Gh, repo: string, tagPrefix: string = TAG_PREFIX): KitSource {
  let refsCache: { etag: string | null; refs: MatchingRef[] } | null = null

  async function listTags(): Promise<MatchingRef[]> {
    const res = await gh(`/repos/${repo}/git/matching-refs/tags/${tagPrefix}`, { etag: refsCache?.etag })
    if (res.status === 304 && refsCache) return refsCache.refs
    if (res.status === 404) return []
    const refs = res.json<MatchingRef[]>()
    refsCache = { etag: res.etag, refs }
    return refs
  }

  return {
    async resolve(ref: string | null): Promise<KitRef> {
      if (ref) {
        const res = await gh(`/repos/${repo}/commits/${encodeURIComponent(ref)}`)
        if (res.status === 404) throw new Error(`${repo} has no ref ${ref}`)
        return { ref, commit: res.json<{ sha: string }>().sha }
      }
      const refs = await listTags()
      const tag = newestTag(refs.map((r) => r.ref), tagPrefix)
      if (!tag) throw new Error(`${repo} has no ${tagPrefix}* tag yet`)
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
