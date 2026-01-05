---
name: Perf + Agent Skills
overview: Tighten the remaining hot-path performance (projects list/thumbnails + DB indexes) with minimal risk, and add a new in-app Anthropic-powered assistant that loads repo-managed “skills” and can suggest/apply improved prompts.
todos:
  - id: measure-hotpaths
    content: Add/confirm lightweight timing + payload metrics for projects list/thumbnails and project detail routes using existing logging utilities.
    status: completed
  - id: fix-project-visibility
    content: Align project visibility to members-only sharing across /api/projects and /api/projects/with-thumbnails; ensure session privacy is respected for thumbnails/counts; update UI copy to match semantics.
    status: completed
  - id: optimize-with-thumbnails-sql
    content: Rewrite /api/projects/with-thumbnails using a single parameterized SQL query ($queryRaw + Prisma.sql) with keyset pagination and a deterministic latest-thumbnail selection.
    status: completed
    dependencies:
      - fix-project-visibility
  - id: reduce-project-overfetch
    content: Update /api/projects/[id] to avoid including sessions by default; make sessions opt-in via query param and align frontend usage.
    status: completed
    dependencies:
      - fix-project-visibility
  - id: frontend-projects-react-query
    content: Refactor /projects page to use useProjects() and React Query invalidation instead of manual no-store fetch; keep behavior identical for users.
    status: completed
    dependencies:
      - optimize-with-thumbnails-sql
  - id: migrations-foundation
    content: Stop ignoring prisma/migrations; re-baseline/structure existing SQL into Prisma migrations; add a deploy step for prisma migrate deploy to make DB changes safe.
    status: completed
  - id: db-indexes
    content: Add composite (and where useful partial) indexes to match real query shapes (sessions visibility, latest completed generations, latest image outputs). Ship as migrations.
    status: completed
    dependencies:
      - migrations-foundation
      - optimize-with-thumbnails-sql
  - id: assistant-skill-registry
    content: Create a repo-managed skill registry (cached loader + validation). Migrate existing genai skill; optionally bring frontend-design skill into repo for production use.
    status: completed
  - id: assistant-api-ui
    content: Implement /api/assistant/chat (Supabase-authenticated) + a lazy-loaded assistant drawer/dialog in the generation UI with “apply to prompt”. Add basic rate limiting and logging.
    status: completed
    dependencies:
      - assistant-skill-registry
---

# Loop Vesper: performance hardening + Anthropic Agents/Skills (minimal-risk rollout)

## What I found (high-signal)

- **Remaining hot path**: `GET /api/projects/with-thumbnails` still does a potentially huge scan (`generation.findMany` over *all* sessions, then filters in JS). This can become the dominant DB cost as generations grow.
- **Access-control mismatch (important)**: You confirmed **shared = invite-based (owner + explicit members only)**. But both [`app/api/projects/route.ts`](app/api/projects/route.ts) and [`app/api/projects/with-thumbnails/route.ts`](app/api/projects/with-thumbnails/route.ts) currently include `isShared: true` projects **without requiring membership**, and `with-thumbnails` also ignores `Session.isPrivate` visibility. That’s both a **privacy risk** and a perf issue.
- **Overfetch**: [`app/api/projects/[id]/route.ts`](app/api/projects/[id]/route.ts) includes full `sessions` by default, but the UI already fetches sessions separately via React Query (`hooks/useSessions.ts`).
- **Migrations foundation is blocked**: `.gitignore` currently ignores `prisma/migrations`, but you already have local SQL migrations under `prisma/migrations/`. If we want to safely add indexes or any DB refactor, we should make migrations a real deployment artifact.
- **Anthropic is already integrated**: `@anthropic-ai/sdk` is in use for prompt enhancement (`/api/prompts/enhance`) and you already have a “skill” file format (`*.skill.md` + `lib/prompts/loadSkill.ts`).

## Goals (aligned to “don’t refactor for the sake of it”)

- **Performance**: Make projects list/thumbnails fast at scale with predictable query cost.
- **Safety**: Fix project/session visibility semantics to match “invite-based sharing.”
- **Incremental**: Ship changes behind feature flags where useful; avoid large rewrites.
- **Assistant**: Add a new in-app assistant UI powered by Anthropic that loads repo-managed skills and can help users craft/apply prompts.

## Phase 0 — Measurement + guardrails (small, low risk)

- Add lightweight timing around the hot endpoints (start/end timestamps + counts) using the existing `lib/metrics.ts`.
- Ensure we don’t ship noisy debug `console.log` spam in core rendering paths (e.g., `components/generation/GenerationInterface.tsx` currently logs generations every render).

## Phase 1 — Fix access control semantics (must-do before caching/optimizing)

Update project visibility to match **members-only** semantics:

- **Projects list**: in [`app/api/projects/route.ts`](app/api/projects/route.ts), remove the “`isShared: true` implies visibility” branch. Visibility should be:
- `ownerId === user.id` OR `members.some({ userId: user.id })`
- **Projects with thumbnails**: same visibility rule as above.
- **Session privacy**: in `with-thumbnails`, ensure thumbnails and session counts only consider sessions the viewer can see:
- Owner: all sessions
- Non-owner member: only `isPrivate = false`
- Update UI copy in [`components/projects/ProjectCard.tsx`](components/projects/ProjectCard.tsx) so “Shared” reads as **“Visible to invited members”**, not “other users.”

## Phase 2 — Rewrite `/api/projects/with-thumbnails` to be truly scalable

Implement a predictable-cost query:

- Replace the multi-step + full scan approach in [`app/api/projects/with-thumbnails/route.ts`](app/api/projects/with-thumbnails/route.ts) with **one SQL query** via `prisma.$queryRaw(Prisma.sql`…`)` (Prisma docs recommend `Prisma.sql` for safe parameterization).
- Use **keyset pagination** over `(updated_at, id)` so we never load “all projects.”
- Use a **LATERAL** subquery (or `DISTINCT ON`) to fetch **1 latest completed image output per project** (respecting session visibility).
- Keep the response shape the same (`thumbnailUrl`, `sessionCount`, `owner`) so the UI doesn’t churn.

Recommended indexes (Phase 2.5) to make the query stable as data grows:

- `sessions`: `(project_id, is_private)`
- `generations`: `(session_id, status, created_at)` (optionally a partial index on `status='completed'`)
- `outputs`: `(generation_id, file_type, created_at)` (optionally partial on `file_type='image'`)

> Note: Prisma schema can express multi-column indexes, but **partial indexes** need raw SQL in a migration (Prisma docs call this out explicitly).

## Phase 3 — Reduce overfetch + align client caching

- Update [`app/api/projects/[id]/route.ts`](app/api/projects/[id]/route.ts) to **not include sessions by default**. Add `?includeSessions=1` if anything still needs them.
- Update the dashboard page to use React Query for projects:
- Switch [`app/projects/page.tsx`](app/projects/page.tsx) to `useProjects()` (`hooks/useProjects.ts`) and remove the `fetch(..., { cache: 'no-store' })` pattern.
- Keep a deliberate invalidation/refetch on create/update/delete.

## Phase 4 — Make DB changes safe (migrations as source of truth)

- Stop ignoring migrations: remove `prisma/migrations` from [`.gitignore`](.gitignore).
- Convert the existing `prisma/migrations/*.sql` into proper Prisma migration folders (or re-baseline cleanly) and document the “authoritative” path.
- Add a deployment step (preferably CI) to run `prisma migrate deploy` before application code is live.

## Phase 5 — In-app assistant (Anthropic + skills)

### 5.1 Skills in-repo (portable + versioned)

- Create a `lib/skills/` (or similar) directory and treat `*.skill.md` as the canonical skill format.
- Migrate/copy:
- Existing `lib/prompts/genai-prompting.skill.md` → usable by assistant.
- (Optional) add `frontend-design.skill.md` to repo (since your local `@…/.claude/skills/frontend-design` path won’t exist in production builds).
- Extend `lib/prompts/loadSkill.ts` into a small **skill registry** (cache in memory; validate frontmatter; allow selecting multiple skills).

### 5.2 Assistant API (server-only)

- Add `POST /api/assistant/chat` (new route) that:
- Authenticates via Supabase (same pattern as other routes).
- Accepts conversation messages + lightweight context (selected model, generation type, current prompt).
- Loads the relevant skill(s) and sends them as system instructions.
- Starts **non-streaming** JSON first; optionally add streaming later.
- Adds basic **rate limiting** / abuse protection (even a simple per-user in-memory limiter is a good start).

### 5.3 Assistant UI

- Add a small chat UI (drawer/dialog) integrated into the generation screen:
- Entry point: an icon button near the existing wand (prompt enhancement) in `components/generation/ChatInput.tsx` and `components/generation/VideoInput.tsx`.
- Allow “Apply to prompt” for suggested prompt text.
- Lazy-load the assistant panel (dynamic import) so it doesn’t impact initial performance.

## Rollout strategy

- Ship Phase 1–3 behind a short-lived flag if you want, but the access-control fix should land first.
- Ship the assistant behind a flag (or limited to admins first), then expand.

---

### Key files (most likely to change)

- API/perf: [`app/api/projects/with-thumbnails/route.ts`](app/api/projects/with-thumbnails/route.ts), [`app/api/projects/route.ts`](app/api/projects/route.ts), [`app/api/projects/[id]/route.ts`](app/api/projects/[id]/route.ts), [`lib/prisma.ts`](lib/prisma.ts)
- Frontend: [`app/projects/page.tsx`](app/projects/page.tsx), [`hooks/useProjects.ts`](hooks/useProjects.ts), [`components/projects/ProjectCard.tsx`](components/projects/ProjectCard.tsx)
- DB foundation: [`.gitignore`](.gitignore), [`prisma/migrations/`](prisma/migrations/)