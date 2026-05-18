# Product Updates pipeline

In-app "What's New" system. Powers the one-time popup that appears once per
user per release, the sidebar `Updates` timeline, and the auto-generation
workflow that produces non-technical release notes from git history.

## Architecture

```
git history ──► git.ts ──► significance.ts ──► generator.ts ──► publish.ts ──► product_updates
                                                                                       │
                                          /api/updates/latest-unseen ◄──── joined ◄────┤
                                          /api/updates                ◄────────────────┤
                                                                                       │
                                          POST /api/updates/:id/seen ──► user_product_update_views
```

## Modules

- `git.ts` — Shells out to `git log` to fetch commits + numstat, then
  clusters them by time gap (default 24h, 36h for backfill).
- `significance.ts` — Scores each cluster 0–1 by mixing user-visible path
  ratio, line/file volume, and keyword sentiment. Threshold defaults to 0.45.
- `generator.ts` — Calls Claude with a strict "no jargon" system prompt and
  JSON-only output. Falls back to a deterministic summary when the LLM is
  unavailable, so the pipeline never silently drops a release.
- `publish.ts` — Generates a stable slug, dedupes by `commit_range_end`, and
  writes the `ProductUpdate` row.
- `types.ts` — Shared `UpdateSnippet` shape + tolerant JSON parser used by
  both the server APIs and the pipeline.

## Running locally

```pwsh
# Preview the next batch without writing anything
npm run updates:generate -- --dry-run

# Auto mode (default): publish clusters since last commit_range_end
npm run updates:generate

# 60-day historical sweep — safe to rerun; dedupes by commit
npm run updates:backfill

# Skip the LLM (e.g. no Anthropic key)
npm run updates:generate -- --no-llm

# Raise the bar for what counts as "significant"
npm run updates:generate -- --threshold=0.55

# Only process the N most recent clusters
npm run updates:generate -- --max=3
```

## CI hook

`.github/workflows/generate-updates.yml` runs on every push to `main` and
once a weekday morning as a safety net. Requires three secrets:

- `DATABASE_URL`
- `DIRECT_URL`
- `ANTHROPIC_API_KEY` (optional; the fallback path runs without it)

## Voice + style rules

Encoded in `generator.ts`:

- Plain language. No git/infra jargon, no file names, no stack names.
- Lead with the user benefit, not the implementation.
- One short sentence per snippet. 2–5 snippets per release.
- Tag with `new`, `improved`, `fix`, or `note`.

The Cursor rule `.cursor/rules/product-updates.mdc` enforces the same voice
when the team writes or reviews entries by hand.

## Database

| Table | Purpose |
| --- | --- |
| `product_updates` | One row per published release entry. |
| `user_product_update_views` | One row per `(user, update)` once dismissed. |

Both tables have RLS enabled. Reads of published `product_updates` are
allowed for any authenticated user; `user_product_update_views` is scoped
to `auth.uid() = user_id`. Writes by the pipeline use the service-role
connection and bypass RLS.

## Safety + dedupe

- Idempotent: re-running the pipeline never creates duplicate cards —
  the unique signal is `commit_range_end` (the newest commit in the cluster).
- Conservative: clusters scoring below the threshold are skipped, with the
  full breakdown printed for inspection.
- Resilient: when the LLM call fails, the deterministic fallback ships a
  basic but always-coherent entry instead of failing the whole run.
