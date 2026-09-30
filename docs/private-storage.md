# Private storage: renders, videos and product renders behind a signature

Branch `feat/private-storage`. The code change comes first; the owner flips the buckets after it is
deployed and checked. Nothing in this branch changes a bucket, the database, an env var or a
deployment.

## The problem

The Supabase buckets `generated-images`, `generated-videos` and `product-renders` are public. Every
render, video and product render, unreleased colourways included, opens for anyone holding its URL
(`https://<project>.supabase.co/storage/v1/object/public/generated-images/mcp/<id>/...jpg`).
`generated-images` also holds the CMF workbooks (`cmf/{owner}/imports/{id}.xlsx`), CMF packet PDFs,
clowns, and since #26/#27 the supplier PDFs (`cmf/{owner}/imports/{id}/pdf/{time}/{file}.pdf`).
`packaging-files` and `creative-pins` are already private and keep their own signing.

Flipping the three buckets private without this change breaks everything that opens a public URL:
every gallery, every download, every model input, every picture Claude shows.

## The design

**No data migration.** Rows keep storing the public URL they were saved with; new writes store the
same form (`uploadBase64ToStorage` still returns it). The public URL is now an identifier, not an
address anyone opens. When a URL is used, `src/lib/storage/refs.ts` reads it back to bucket and path,
and `src/lib/storage/access.ts` signs it for the reader. It reads the public, signed, authenticated and
resized (`render/image`) forms, the new `/api/storage/...` form, and, where asked, `bucket/path`; only
for the three buckets and only on this project's Supabase host. One write normalises: a reference URL
Claude hands back (a signed one from an earlier result) is stored in its public form, without its expiry.

| Reader | Expiry | Why |
|---|---|---|
| A signed-in person's page view | 1 hour, re-signed on every load | `/api/storage/...` signs per request; the browser may keep the redirect for 30 minutes, half the signature, so what it keeps still opens |
| Vesper reading its own file on the server | 5 minutes | fetched at once |
| A model provider fetching an input | 1 hour | signed when the job is dispatched to the provider, not when it was queued in Vesper; covers the provider's own queue and cold start |
| Claude (MCP results) | 7 days | the markdown image claude.ai draws, and the link a person opens from the chat, keep working through the week a piece of work usually runs; asking again (get_generation_status, list_product_renders) signs afresh |

**Flip-safe.** A signed URL works on a public bucket too, so every path above works before and after
the flip. When signing fails, the stored public URL is used: that works until the flip and fails no
worse after. Deploy first, flip after.

### The pieces

- `src/lib/storage/refs.ts`: parsing, `toViewUrl`, `toDownloadUrl`, `canonicalStorageUrl`. No server imports.
- `src/lib/storage/access.ts`: the expiries; `signStoredUrl`, `signStoredUrlsDeep` (one batch
  `createSignedUrls` call per bucket, whole strings and URLs inside text), `fetchStored`.
- `GET /api/storage/<bucket>/<path>` (`src/lib/storage/browser-route.ts`): signed-in, active accounts
  only (`getAuthUser`, which refuses paused and deleted profiles); a 302 to an hour's signature;
  `?download=<name>` answers as an attachment; `?w=<width>&q=` answers a resized WebP made with sharp
  behind the sign-in, for `next/image` (`src/lib/storage/image-loader.ts`). Vercel's optimizer cannot
  pass a sign-in and would cache the picture for anyone who knows the address, so it is not used for
  these files. Widths are limited to next.config's device and image sizes.
- `withSignedInputs` in `src/lib/models/registry.ts`: every adapter from `getModel` signs the stored
  files in its request, however deep in `parameters`, before the provider sees them.
- `src/lib/headless/mcp-dispatch.ts`: every `tools/call` result and `resources/read` is signed for 7 days.

## Inventory

Counts are sites in the code at merge of `origin/main` a7677b6.

### Producers (write a public URL; unchanged)

`uploadBase64ToStorage` / `uploadUrlToStorage` / `getPublicUrl` / string-built public URLs in:
generation processing and the Replicate webhook, generation sync, snapshots, reference image and media
uploads, PDF bucket images, brainstorm attachments, product-render admin (single, bulk, update), CMF
clowns (single, bulk), CMF import (workbook), CMF packet PDF, CMF render and refinement references,
the MCP draw and video tools (original and preview), creative draws (`work-runtime.ts`), packaging
composites (`flow.ts publicUrl`), the supplier PDF (`cmf_pdf`), the client's `getPublicUrl` for
reference ids, `gallery-utils.getPublicStorageUrl`, `cmf/storage.ts`, the sigil route, and the
scripts `import-product-renders.mjs` and `seed-cmf-clowns.mjs`. They keep writing the public form.

### Columns that store a full public URL (read back at use; no migration)

`Output.fileUrl` (renders, videos, snapshots, bookmarks and downloads join to it),
`Generation.parameters` (`referenceImageUrl`, `referenceImages[]`, `endFrameImageUrl`,
`referenceImageUrls` / `referenceVideoUrls` / `referenceAudioUrls`, `anchor.url`),
`ProductRender.imageUrl`, `CmfClownAsset.imageUrl`, `CmfRender.renderUrl`,
`CmfRenderAttempt.imageUrl`, `CmfPacket.pdfUrl`, `PdfBucketImage.imageUrl`, `TimelineClip.fileUrl`,
`TimelineRenderJob.outputUrl`, `CreativeGrade.imageUrl`, `CreativeVerdict.imageUrl`, MCP job payloads
(summary text and structured content), brainstorm messages (attachment URLs in the text).

### Consumers, by who reads

**Authenticated people (the web app)**: 39 files, about 85 load sites, now through `toViewUrl`
(`/api/storage`), `toDownloadUrl`, or the `next/image` storage loader:

- `<img>` and `<video>`: gallery (outputs, reference and start/end frame thumbnails), lightbox, branch
  stack, snapshot rail, PDF bucket rail (and its drag image), product-render picker and settings,
  reference-set picker, chat and video inputs (previews, full view, start and end frames), image-to-video
  overlay, community dialog, downloads history and its flight animation, bookmarks, review, home page,
  timeline editor (preview video, probes, thumbnails, prompt reference), timeline gallery, video picker,
  project cards, session thumbnails, CMF clown library, document preview, attempt cards, inspect lightbox
  (and its reference links), refine panel, references tab, SKU cards, brainstorm attachments.
- `next/image` (4): gallery, image browser, home page, review. They use the storage loader.
- Fetch-to-blob downloads and re-reads (12): gallery, lightbox download, downloads history, bookmarks,
  review, community dialog, video overlay, chat input (browse and hydrate), video input (start and end
  frame), iteration slate, prompt enhancement.
- Links and frames: CMF packet PDF (`window.open` twice, PdfTab open, iframe, and a download as an
  attachment), timeline export link.
- three.js textures (2): brand-world billboards.

**Claude (the MCP connector)**: one choke point (`dispatch`) covers every tool result and resource
read: `generate_asset`, `generate_video`, `get_generation_status` (jobs collected later),
`generate_product_image`, `list_product_renders` and `vesper://product-renders`, `cmf_render`,
`cmf_pdf` (the supplier PDF link), `packaging_mockup` / `packaging_finish` (composites), grading and
reading tools. Markdown image lines, "Full resolution" links, `resource_link` URIs and structured
`url` / `previewUrl` fields are all signed. Exception: `export_creative_records` keeps the canonical
URL, as `GET /api/headless/v1/creative/*` does, because the plugin repository's nightly job commits
those rows to git. References Claude passes in (signed or public) are fetched through the allowlist,
which now signs.

**Third-party servers**:

- Model providers (one choke point, `withSignedInputs`, covering the six `generate` callers: generation
  processing, CMF render, packaging finish, creative draws, MCP image, MCP video): Replicate (Seedream,
  Reve, Kling 2.6, Seedance reference sets, the nano-banana fallback), Kling official (start and end
  frame), fal, OpenAI (fetched by the adapter), Gemini and Veo (fetched by the adapter).
- Gemini captioning, Claude (brainstorm chat) and the sigil analysers receive bytes Vesper fetched,
  not URLs.
- The creative worker: packaging already hands it signed GET and PUT URLs for `creative-pins` and the
  outputs bucket; the CMF spec check gets bytes. No change was needed.

**Vesper's own server reads** (now through a 5-minute signature): the fetch allowlist
(`fetchAllowlisted`, used by pin sync and the daily pin cron's clowns, grading candidates, CMF PDFs
and supplier-PDF render images, prompt enhance and iterate references, MCP references),
`downloadReferenceImageAsDataUrl` (references and lineage anchors), `uploadUrlToStorage` (copying a
stored file), MCP previews and product renders (`readImageBytes`, `probeMimeType`), captioning,
CMF packet PDF images, both sigil analysers, brainstorm attachments. Service-role downloads (the
workbook reader, pins, packaging) work regardless of the flag.

### Not changed, and why

- **Share links**: none exist.
- **Frontify**: Vesper only reads from it (renders, approvals); nothing of ours is sent there.
- **Figma**: the sigil export is a stub that sends no image.
- **Cron**: `creative-pins` reads clowns through the allowlist (covered); `mcp-jobs` runs queued jobs
  through the same adapters and dispatcher (covered); `oauth-cleanup` touches no files.
- **Timeline render**: the route computes a plan for an external FFmpeg worker that does not exist
  in this repository. A worker built later needs signed URLs or the service role.
- **`next.config.js` `remotePatterns`** keeps `*.supabase.co`. After the flip an unsigned URL fails
  there as anywhere, and a signed one needs its token; nothing depends on it for these files any more.
- **Drag and drop** (`text/uri-list` from the PDF bucket rail and snapshot rail) carries the stored
  URL. Dropped inside Vesper it works; dropped into another app it is a dead link after the flip.
- **Avatars** are not in these buckets.
- **The plugin repository's records** keep public URLs that stop opening after the flip, which is intended.

## The owner's flip, written out (not run)

Order: **deploy, check, flip, check.**

1. **Deploy** this branch to Production with the buckets still public.
2. **Check, buckets still public**, signed in:
   - A project gallery loads; in DevTools every stored image is `/api/storage/...?w=` (200, `image/webp`)
     or a 302 from `/api/storage/...` to `.../storage/v1/object/sign/...?token=`.
   - A video plays; a render and a video download; a CMF packet PDF opens, downloads and shows in its frame.
   - A generation with a reference image, and a video with a start frame (Kling, Seedance), complete.
   - In claude.ai, `generate_asset` shows its picture; its links contain `/object/sign/` and `token=`.
     `cmf_pdf` returns a signed link.
   - Vercel logs show no `[storage] could not sign`.
3. **Flip**, in the Supabase SQL editor:

   ```sql
   update storage.buckets
      set public = false
    where id in ('generated-images', 'generated-videos', 'product-renders');

   select id, public from storage.buckets
    where id in ('generated-images', 'generated-videos', 'product-renders');
   ```

   Or in the dashboard: Storage, each of the three buckets, Edit bucket, turn off "Public bucket", Save.
4. **Check, buckets private**:
   - An old public URL answers 400 (or 403/404, depending on the storage version):
     `curl -s -o /dev/null -w "%{http_code}\n" "https://<project>.supabase.co/storage/v1/object/public/generated-images/<path>"`
   - The same file through Vesper without a sign-in answers 401:
     `curl -s -o /dev/null -w "%{http_code}\n" "https://<vesper-host>/api/storage/generated-images/<path>"`
   - Signed in, the same address answers 302, and its `location` answers 200.
   - A signed link from a fresh MCP result answers 200.
   - Repeat the checks from step 2.
   - Try a popular old public URL. If it still answers 200 with a CDN cache hit header, Supabase's edge
     still holds a copy: wait for it to expire, or ask Supabase to purge it.

**Rollback**: set the flag back; nothing else is needed, because the code works on public buckets too.

```sql
update storage.buckets
   set public = true
 where id in ('generated-images', 'generated-videos', 'product-renders');
```

If the code itself must be rolled back, flip the buckets public first.

## Risks after the flip

- **Links shared before the flip die at the flip**: public URLs pasted into Slack, Figma, Notion,
  documents or old claude.ai chats. There is no redirect from the public path. Open the draw in Vesper,
  or ask Claude again (`get_generation_status`, `list_product_renders`) for a fresh link.
- **Links Claude hands out die after 7 days**: a claude.ai chat older than a week shows broken pictures.
- **A slow provider**: a provider that holds a job in its own queue for more than an hour before it
  fetches the inputs fails on them. Vesper's own queue does not count, since signing happens at dispatch.
- **A tab left open**: a video paused for more than an hour and then scrubbed may fail its next range
  request; a reload fixes it.
- **Who can open a file**: any signed-in, active Vesper account can open any file in the three buckets
  whose path it knows (the paths hold UUIDs). Before, anyone with the URL could. If Supabase Auth allows
  open sign-up, restrict it to Loop's domain.
- **Cost**: every stored file a page shows is now a function call (a sign-in check and a signature),
  and `next/image` thumbnails are resized by sharp in a function rather than by Vercel's optimizer. The
  browser keeps redirects for 30 minutes and thumbnails for a day.
- **Copies already made** (downloads, browser caches, CDN edge copies until they expire) stay where
  they are; the flip stops new public fetches, it does not recall old ones.

## Tests

`tests/private-storage.spec.ts` runs each consumer against a fake storage twice, with the buckets public
and private: the browser route (redirect, download, resize, refusal without a sign-in, other buckets),
the MCP dispatcher (markdown image, links, structured result, one signing call; records left
canonical), the model wrapper (nested inputs, data and provider URLs untouched, the request not
mutated), Vesper's own reads (allowlist, reference download), and the fallback when signing fails.

## Who may open stored media

The browser route asks for more than a sign-in. Accounts are not approved by anyone, so a new
account could otherwise open any file whose path it knows. `src/lib/storage/media-access.ts`
lets in a confirmed email on `MEDIA_ACCESS_DOMAINS` (default `loopearplugs.com`) or an admin; anyone
else gets a 403. On 2026-09-30 Vesper had 58 accounts: 54 on loopearplugs.com, plus four others
(none active in 60 days except the owner's own, which is an admin). To let a partner in, add their
domain to `MEDIA_ACCESS_DOMAINS` in Vercel.
