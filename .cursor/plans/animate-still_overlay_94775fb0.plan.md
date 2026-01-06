---
name: Animate-still overlay
overview: Replace the current Convert-to-Video modal with a glassy, semi-transparent overlay composer that lets users generate video iterations from a still without leaving the image session, while showing those iterations as stacked layers behind the image card and inside the overlay.
todos:
  - id: add-video-iterations-api
    content: Add /api/outputs/[outputId]/video-iterations endpoint with auth + project access checks + JSONB query for parameters.sourceOutputId
    status: completed
  - id: add-video-iterations-hook
    content: Create useVideoIterations hook with smart polling while processing
    status: completed
    dependencies:
      - add-video-iterations-api
  - id: video-input-overlay-variant
    content: Extend VideoInput with overlay/locked-reference props + referenceImageIdOverride support
    status: completed
  - id: image-to-video-overlay-ui
    content: Implement ImageToVideoOverlay (glass UI, session picker, uses VideoInput + useGenerateMutation, shows iteration history)
    status: completed
    dependencies:
      - add-video-iterations-hook
      - video-input-overlay-variant
  - id: gallery-stack-integration
    content: Replace VideoSessionSelector with ImageToVideoOverlay and add stacked-iterations hint behind image cards
    status: completed
    dependencies:
      - image-to-video-overlay-ui
  - id: types-and-allowlist
    content: Update useGenerateMutation types to allow sourceOutputId and add sourceOutputId to generations parameter allowlist (optional but recommended)
    status: completed
    dependencies:
      - add-video-iterations-api
---

# Inline image→video overlay + stacked iterations

## Goal

When a user clicks the **Convert to Video** icon on an image output in the gallery:

- Stay in the **current image session** (no tab switch).
- Open a **semi-transparent overlay** that feels attached to the selected image.
- Let the user pick/create a **video session** and fill the **full video prompt bar** (model, aspect ratio, resolution, duration, prompt enhancement).
- Generate videos into the chosen video session, and show **iteration history** as stacked layers:
- **In-gallery**: subtle stack behind the image card + count/status hint.
- **In-overlay**: scrollable, playable history list + layered preview.

## Key design/architecture decision

### Persist a stable link: `sourceOutputId`

To make “iterations for this still” queryable without schema changes, we’ll store a stable reference in `Generation.parameters` for video generations created from a still:

- `parameters.sourceOutputId = <image_output_id>`

This works because `Generation.parameters` is `Json` and the generate API stores arbitrary `otherParameters`.

## Data flow (high level)

```mermaid
sequenceDiagram
  participant User
  participant Gallery as GenerationGallery
  participant Overlay as ImageToVideoOverlay
  participant API as api/generate
  participant IterAPI as api/outputs/:outputId/video-iterations
  participant DB as Postgres

  User->>Gallery: ClickConvertToVideo(output)
  Gallery->>Overlay: Open(outputId,imageUrl)
  Overlay->>Overlay: SelectOrCreateVideoSession
  Overlay->>API: POST /api/generate(sessionId=videoSessionId, modelId, prompt, parameters{..., sourceOutputId})
  API->>DB: CreateGeneration(status=processing, parameters include sourceOutputId)
  Overlay->>IterAPI: GET iterations(outputId) (poll while processing)
  IterAPI->>DB: Query video generations where parameters.sourceOutputId==outputId
  DB-->>IterAPI: generations + outputs
  IterAPI-->>Overlay: iterations
  Overlay-->>Gallery: close or keep open; Gallery shows stack count
```



## Backend changes

### 1) Add a video-iterations endpoint keyed by output

Create `[app/api/outputs/[outputId]/video-iterations/route.ts](app/api/outputs/[outputId]/video-iterations/route.ts)`:

- **Auth**: same pattern as [`app/api/generate/route.ts`](app/api/generate/route.ts).
- **Access check**: ensure the requesting user is owner/member of the output’s project.
- **Query**: fetch *video* generations in the same project where:
- `generation.userId === currentUserId` (consistent with [`app/api/generations/route.ts`](app/api/generations/route.ts) behavior)
- `generation.session.type === 'video'`
- `generation.parameters.sourceOutputId === outputId`
- **Return**: compact payload for UI (id, status, createdAt, session {id,name}, modelId, prompt, outputs (video URLs), and reference pointers).

Implementation detail:

- Prefer Prisma JSON path filter (Prisma v6 supports it). If it’s finicky, fall back to `prisma.$queryRaw` with JSONB: `parameters->>'sourceOutputId' = $1`.

### 2) Allowlist `sourceOutputId` in session generations (optional but recommended)

Update [`app/api/generations/route.ts`](app/api/generations/route.ts) `ALLOWED_PARAMETER_FIELDS` to include:

- `sourceOutputId`

This keeps debug/consistency and prevents the field from being stripped if we ever surface it in normal session views.

## Frontend changes

### 3) Extend `VideoInput` to support an “overlay / locked reference” variant

Update [`components/generation/VideoInput.tsx`](components/generation/VideoInput.tsx):

- Add props:
- `variant?: 'default' | 'overlay'` (reduce padding, tighter controls row)
- `lockedReferenceImage?: boolean` (hide remove button)
- `hideReferencePicker?: boolean` (hide Upload/Browse + product renders buttons)
- `referenceImageIdOverride?: string` (so reference pointer ID can be stable per output)
- When hydrating `referenceImageUrl`, set `referenceImageId` to `referenceImageIdOverride ?? createReferenceId()`.

Result: We can reuse the exact prompt+controls UX, but keep it minimal and “single-purpose” for animating the selected still.

### 4) New overlay component: `ImageToVideoOverlay`

Add [`components/generation/ImageToVideoOverlay.tsx`](components/generation/ImageToVideoOverlay.tsx):Responsibilities:

- **Session target**: minimal “Existing / New” selector (use [`components/ui/tabs.tsx`](components/ui/tabs.tsx) + [`components/ui/select.tsx`](components/ui/select.tsx) + [`components/ui/input.tsx`](components/ui/input.tsx)).
- **Video controls**: render `VideoInput` with:
- `referenceImageUrl = selectedImageUrl`
- `referenceImageIdOverride = outputId`
- `lockedReferenceImage=true`, `hideReferencePicker=true`, `variant='overlay'`
- **Generate**:
- Use `useGenerateMutation()` directly here.
- On generate, call `/api/generate` with:
    - `sessionId = selectedVideoSessionId`
    - `modelId = localSelectedModel`
    - `parameters = {...videoParams, numOutputs: 1, referenceImage: <base64>, referenceImageId: outputId, sourceOutputId: outputId }`
- Keep overlay open after generating (flow state).
- **Iterations UI**:
- Use a new hook `useVideoIterations(outputId)` (see below).
- Right pane: layered preview (still as base layer; selected video iteration above) + scrollable list of iterations (newest first) with status chips.

Styling (on-brand):

- Glass container: `bg-background/30 backdrop-blur-xl border border-border/40 rounded-[var(--radius)] shadow-2xl`.
- Accent: use `border-primary/20` / `ring-1 ring-primary/20` (mint in dark mode per [`app/globals.css`](app/globals.css)).
- Optional “scanline” vibe without hardcoding orange: add a subtle repeating-linear-gradient overlay using `hsl(var(--primary) / …)` so it adapts to theme.

### 5) Hook: `useVideoIterations`

Add [`hooks/useVideoIterations.ts`](hooks/useVideoIterations.ts):

- React Query `useQuery` to `GET /api/outputs/:outputId/video-iterations?limit=...`.
- Poll while any iteration is `processing`:
- `refetchInterval: (data) => data?.some(p => p.status==='processing') ? 2000 : false`
- Expose `{ iterations, count, latestStatus }`.

### 6) Integrate into the gallery + remove old modal

Update [`components/generation/GenerationGallery.tsx`](components/generation/GenerationGallery.tsx):

- Replace `VideoSessionSelector` usage with `ImageToVideoOverlay`.
- On video icon click, open overlay for the specific **output** (store `selectedOutputId` + `selectedImageUrl`).
- Add a subtle “stack behind card” hint:
- New component [`components/generation/VideoIterationsStackHint.tsx`](components/generation/VideoIterationsStackHint.tsx)
- Uses `useVideoIterations(outputId)` with `limit=3` and displays:
    - 2–3 offset translucent layers behind the image card
    - a small badge: “3 videos” + latest status
- Clicking the stack opens the overlay.

Note: to avoid request explosion, `VideoIterationsStackHint` should only mount for visible items (already true because the gallery is virtualized) and should use a generous `staleTime`.

### 7) Types

Update [`hooks/useGenerateMutation.ts`](hooks/useGenerateMutation.ts) `GenerateParams.parameters` typing to allow the extra field(s):

- `sourceOutputId?: string`

(Backend already accepts/forwards unknown parameters via `otherParameters` in [`app/api/generate/route.ts`](app/api/generate/route.ts).)

## Edge cases / behavior

- **No video sessions**: overlay defaults to “Create New”, with a suggested name like `"Video – <date>"`.
- **Model doesn’t support image→video**: `VideoInput` already detects `supportsImageToVideo`; we’ll keep the reference image locked but still allow text-to-video models (warn if no reference support).
- **Existing, previously-generated videos** won’t appear in stacks unless they were generated with `sourceOutputId` set. (New flow will link automatically.)

## Testing checklist

- Click video icon on an image output → overlay opens, no session switch.
- Create new video session inside overlay → generate → overlay remains open.
- Close overlay → image card shows stacked hint + count.