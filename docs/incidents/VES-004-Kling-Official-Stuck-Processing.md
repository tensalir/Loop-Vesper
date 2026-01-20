# VES-004: Fix: Kling 2.6 (Official API) Intermittent 401 + “Stuck Processing”

## Status: ✅ RESOLVED

## Summary

Kling 2.6 generations via the **official Kling API** (not Replicate) would either:

- Fail intermittently with `401 Unauthorized` / `"Authorization signature is invalid"`, or
- Complete on Kling’s side but remain **stuck in “processing”** in Loop Vesper (no completion/failure transition), sometimes for 5+ minutes.

This took longer than expected to fix because it was **not a single bug**: multiple independent issues overlapped and masked each other.

## Symptoms (What we saw)

- **Intermittent 401s** from Kling during submit and/or status polling.
- **Generations stuck “processing”** indefinitely in the UI even when Kling was returning successful status responses.
- Occasional **duplicate processing** attempts for the same `generationId` (two concurrent `process` runs racing).
- A hard runtime failure: `Body is unusable: Body has already been read` (during polling retry/error handling).

## Root Causes (Why it happened)

### 1) Duplicate background processing (race condition)

`/api/generate/process` could be triggered multiple times for the same generation (frontend + server, retries, etc.). The previous “is already processing” guard was **non-atomic** (read → check → later write), which allowed concurrent workers to pass the check and both submit/poll.

**Effect:**
- Duplicate submissions/polling
- Confusing logs and non-deterministic outcomes
- Increased chance of hitting transient provider errors

### 2) Polling retry read the same `Response` body twice

In the status polling error path, we retried the status endpoint and attempted to parse JSON and also reuse the same `Response` later. In Fetch, a `Response` body is a one-time stream; reading it twice throws:

- `Body is unusable: Body has already been read`

**Effect:**
- Polling could crash even when the retry was successful

### 3) Kling status payload shape drift (object vs array)

Our status parsing assumed the status response looked like:

- `statusData.data.task_status`

But the official Kling status endpoint sometimes returns `data` as an **array** (and/or an array of task-like objects), so `task_status` was **never found**, leaving Loop Vesper unable to transition the generation to `completed` or `failed`.

**Effect:**
- Kling could finish, but the app would keep showing “processing”

### 4) Provider-side intermittent auth failures (submit + poll)

Even with correct JWT generation, Kling occasionally returned `401` signature failures intermittently. Treating these as fatal made the system brittle.

**Effect:**
- Random failures that were hard to reproduce reliably

## Fix (What we changed)

### Server-side idempotency: atomic processing lock

Implemented an **atomic DB lock** so only one `/api/generate/process` runner can “own” a generation for a time window. Any concurrent invocation exits early as `skipped`.

### Kling adapter hardening

- **Submit retry**: on `401` signature-invalid errors, retry submit with a freshly generated JWT (bounded attempts).
- **Polling resilience**: tolerate intermittent `401` signature-invalid errors during polling (bounded streak/attempts).
- **Response reuse fix**: clone the retry `Response` before reading `.json()` when the same response must be used later.
- **Status parsing fix**: robustly handle `statusData.data` being an object **or** array; select the right task record (prefer matching `task_id`) and normalize status strings.

## Why it took so long (The “why this was painful” part)

- **Multiple overlapping failure modes**: fixing one symptom (duplicate processing) exposed the next (response body reuse), then the next (status payload shape).
- **Intermittency**: Kling’s 401 signature failures were not reliably reproducible, so “works once” didn’t mean “fixed”.
- **Silent/partial success**: status requests could return `200 OK` while our parser still produced a `null` status, so the system looked “alive” but never completed.
- **Cross-system boundary**: the true “source of truth” was an external API with evolving response shapes; assumptions that were previously safe became invalid.

## Files touched (Fix implementation)

- `src/app/api/generate/process/route.ts` (atomic processing lock)
- `src/lib/models/adapters/kling.ts` (submit retry, polling resilience, response clone, status parsing normalization)

## Prevention (Sentinel lessons added)

This incident directly informed new best practices in `.sentinel.md`:

- **Server-side idempotency** for background processors (atomic lock / compare-and-set)
- **Fetch `Response` bodies are single-use** (clone before double-read)
- **Polling payload shape drift** (normalize object vs array, log shape when unknown)

