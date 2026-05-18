/**
 * Generate user-facing update notes from recent git history and publish them
 * as `ProductUpdate` rows.
 *
 * Modes:
 *
 *   npm run updates:generate
 *       Auto mode. Considers commits since the newest already-published
 *       commit (or the last 7 days if the DB is empty). Skips clusters
 *       below the significance threshold. Idempotent — reruns dedupe by
 *       commit range.
 *
 *   npm run updates:generate -- --backfill --since=60d
 *       Backfill mode. Walks the full window and publishes every cluster
 *       above the threshold with `backfilled=true`. Safe to rerun (dedupe).
 *
 *   npm run updates:generate -- --dry-run
 *       Don't write to the DB. Prints what the publish layer would have
 *       written so you can eyeball the copy.
 *
 *   npm run updates:generate -- --no-llm
 *       Skip the Claude call and use the deterministic fallback. Useful in
 *       CI without an Anthropic key, or for testing the pipeline locally.
 *
 *   npm run updates:generate -- --threshold=0.55
 *       Override the default significance threshold (0.45).
 *
 *   npm run updates:generate -- --max=10
 *       Cap the number of clusters published in one run (newest-first).
 *       Default is 50 for auto mode, no cap for backfill.
 */

import { prisma } from '../src/lib/prisma'
import {
  listCommitsWithFiles,
  clusterCommits,
  type GitCommitWithFiles,
} from '../src/lib/updates/git'
import { scoreCluster } from '../src/lib/updates/significance'
import { generateUpdate } from '../src/lib/updates/generator'
import { publishUpdate } from '../src/lib/updates/publish'

interface CliOptions {
  backfill: boolean
  dryRun: boolean
  noLlm: boolean
  threshold: number
  since: string | null
  max: number | null
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2)
  const opts: CliOptions = {
    backfill: false,
    dryRun: false,
    noLlm: false,
    threshold: 0.45,
    since: null,
    max: null,
  }
  for (const arg of args) {
    if (arg === '--backfill') opts.backfill = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--no-llm') opts.noLlm = true
    else if (arg.startsWith('--threshold=')) {
      const v = Number(arg.slice('--threshold='.length))
      if (Number.isFinite(v)) opts.threshold = v
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.slice('--since='.length)
    } else if (arg.startsWith('--max=')) {
      const v = Number(arg.slice('--max='.length))
      if (Number.isFinite(v) && v > 0) opts.max = v
    }
  }
  return opts
}

/** Resolve the lower bound for the auto path: the newest commit we already
 *  published, or null if the DB has nothing yet. */
async function findLastPublishedCommit(): Promise<string | null> {
  const latest = await prisma.productUpdate.findFirst({
    where: { commitRangeEnd: { not: null } },
    orderBy: { publishedAt: 'desc' },
    select: { commitRangeEnd: true },
  })
  return latest?.commitRangeEnd ?? null
}

async function main() {
  const opts = parseArgs()
  console.log('[updates] options:', opts)

  let commits: GitCommitWithFiles[]
  if (opts.backfill) {
    const since = opts.since ?? '60d'
    console.log(`[updates] backfill mode, scanning since ${since}`)
    commits = await listCommitsWithFiles({ since })
  } else {
    const fromRef = await findLastPublishedCommit()
    if (fromRef) {
      console.log(`[updates] auto mode, scanning since commit ${fromRef.slice(0, 10)}`)
      try {
        commits = await listCommitsWithFiles({ fromRef })
      } catch (err) {
        console.warn(
          `[updates] last published commit not in git history; falling back to 7d window:`,
          (err as Error).message
        )
        commits = await listCommitsWithFiles({ since: opts.since ?? '7d' })
      }
    } else {
      const since = opts.since ?? '7d'
      console.log(`[updates] no published updates yet, scanning since ${since}`)
      commits = await listCommitsWithFiles({ since })
    }
  }

  if (commits.length === 0) {
    console.log('[updates] no new commits found — nothing to publish.')
    return
  }
  console.log(`[updates] inspected ${commits.length} commits.`)

  // Cluster: 24h gap, max 40 commits per cluster. Backfill loosens the gap
  // a touch so a sleepy weekend doesn't shatter into single-commit entries.
  const clusters = clusterCommits(commits, {
    maxGapHours: opts.backfill ? 36 : 24,
    maxClusterSize: 40,
  })
  console.log(`[updates] grouped into ${clusters.length} cluster(s).`)

  const maxClusters = opts.max ?? (opts.backfill ? clusters.length : 50)

  let created = 0
  let skipped = 0
  let belowThreshold = 0

  for (let i = 0; i < Math.min(clusters.length, maxClusters); i++) {
    const cluster = clusters[i]
    const significance = scoreCluster(cluster)
    const range = `${cluster[cluster.length - 1].shortSha}..${cluster[0].shortSha}`
    console.log(
      `\n[updates] cluster ${i + 1}/${clusters.length} (${cluster.length} commits, ${range})`
    )
    for (const reason of significance.reasons) console.log(`  · ${reason}`)
    console.log(`  → score=${significance.score.toFixed(2)} threshold=${opts.threshold}`)

    if (significance.score < opts.threshold) {
      console.log('  skipping (below threshold)')
      belowThreshold++
      continue
    }

    const generated = await generateUpdate(cluster, significance.userVisibleFiles, {
      forceFallback: opts.noLlm,
    })
    console.log(`  generated via ${generated.source}: "${generated.title}"`)
    for (const snippet of generated.snippets) {
      console.log(`    • [${snippet.tag ?? 'note'}] ${snippet.label}: ${snippet.body}`)
    }

    if (opts.dryRun) {
      console.log('  (dry-run) skipping DB write')
      continue
    }

    const result = await publishUpdate({
      cluster,
      generated,
      significanceScore: significance.score,
      backfill: opts.backfill,
    })
    if (result.status === 'created') {
      created++
      console.log(`  published: ${result.slug}`)
    } else {
      skipped++
      console.log(`  duplicate: already published as ${result.slug}`)
    }
  }

  console.log(
    `\n[updates] done. created=${created}, duplicates=${skipped}, below-threshold=${belowThreshold}`
  )
}

main()
  .catch((err) => {
    console.error('[updates] fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
