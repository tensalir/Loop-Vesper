/**
 * POST /api/cmf/renders/[id]/refinement-references
 *
 * Phase 2 of iterative refinement: drop point for designer-supplied
 * reference images that go alongside a refinement prompt.
 *
 * Why a separate upload step rather than inline multipart on the
 * generate route:
 *   - Keeps the generate API JSON-only, which makes the React
 *     mutation hook simple (no FormData branching).
 *   - Lets the UI show upload progress per file before the
 *     designer commits to "Generate refined attempt".
 *   - The designer can drop refs progressively and see the
 *     thumbnails populate before submitting.
 *
 * Storage layout (see refinementReferenceStoragePath):
 *   cmf/{ownerId}/packets/{packetId}/refinements/{batchId}/{filename}
 *
 * One HTTP request = one batchId = one folder. The returned paths
 * get passed verbatim into the generate body's `referenceImagePaths`,
 * and the render service stores them on the new attempt row.
 *
 * Caps: max 4 files per request, max 8MB per file. Validated server-
 * side because the multipart body is unconstrained on the wire.
 * Returns 403 (cmf write access required), 400 (validation), 500
 * (storage failure).
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireCmfWrite } from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import {
  CMF_STORAGE_BUCKET,
  refinementReferenceStoragePath,
  safeFileSlug,
} from '@/lib/cmf/storage'

export const dynamic = 'force-dynamic'

// Generous limit since image uploads are heavier than text. Same
// rate-limit posture as the bulk clown uploader.
const refUploadLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: 60_000,
})

const MAX_FILES_PER_REQUEST = 4
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024 // 8MB
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const limited = refUploadLimiter.check(auth.profile.userId)
  if (limited) return limited

  // Resolve the parent render so we know the packet (for the
  // storage path scope) and can attribute the upload owner.
  const render = await prisma.cmfRender.findUnique({
    where: { id: params.id },
    select: { id: true, packetId: true, ownerId: true },
  })
  if (!render) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 })
  }

  // Parse multipart. FormData-aware to keep the route self-contained
  // (no extra dependencies). Pulls files out of the canonical "files"
  // field; clients can repeat the field for multi-upload.
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart body' },
      { status: 400 }
    )
  }
  const rawFiles = formData.getAll('files').filter((v): v is File => v instanceof File)
  if (rawFiles.length === 0) {
    return NextResponse.json(
      { error: 'No files provided. Use the "files" field (repeated) with image uploads.' },
      { status: 400 }
    )
  }
  if (rawFiles.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many files: ${rawFiles.length}. Cap is ${MAX_FILES_PER_REQUEST} per request — drop the rest later if needed.`,
      },
      { status: 400 }
    )
  }
  for (const file of rawFiles) {
    if (file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        {
          error: `File "${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB; max is ${MAX_BYTES_PER_FILE / 1024 / 1024}MB.`,
        },
        { status: 400 }
      )
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error: `File "${file.name}" has unsupported type "${file.type}". Use PNG, JPEG, or WebP.`,
        },
        { status: 400 }
      )
    }
  }

  // One batchId per HTTP request — every file in this upload lands
  // in the same folder. Cheap collision protection (uuid v4).
  const batchId = randomUUID()

  const uploaded: Array<{ path: string; url: string; filename: string }> = []
  for (const file of rawFiles) {
    // Slug the filename so we never write user-controlled characters
    // into storage. Preserves the extension separately so the
    // mime-type / file-extension stays sensible.
    const dotIndex = file.name.lastIndexOf('.')
    const ext = dotIndex >= 0 ? file.name.slice(dotIndex + 1).toLowerCase() : 'png'
    const stem = dotIndex >= 0 ? file.name.slice(0, dotIndex) : file.name
    const safeName = `${safeFileSlug(stem) || 'ref'}.${safeFileSlug(ext) || 'png'}`
    const path = refinementReferenceStoragePath({
      ownerId: render.ownerId,
      packetId: render.packetId,
      batchId,
      filename: safeName,
    })

    // File → Buffer → base64 data URL → existing helper. The
    // base64 round-trip wastes ~33% memory but keeps us off the
    // private supabaseAdmin client and matches how every other
    // CMF upload path works (clown library, generated renders,
    // PDFs all funnel through uploadBase64ToStorage).
    const buffer = Buffer.from(await file.arrayBuffer())
    const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`
    let publicUrl: string
    try {
      publicUrl = await uploadBase64ToStorage(dataUrl, CMF_STORAGE_BUCKET, path)
    } catch (err) {
      // Best-effort error surface. Partial uploads on prior files
      // are intentionally NOT rolled back — they're cheap to leave
      // behind and the client can retry the failed file.
      const message = err instanceof Error ? err.message : 'Upload failed'
      return NextResponse.json(
        {
          error: `Upload failed for "${file.name}": ${message}`,
          uploaded,
        },
        { status: 500 }
      )
    }

    uploaded.push({
      path,
      url: publicUrl,
      filename: safeName,
    })
  }

  return NextResponse.json({
    batchId,
    references: uploaded,
  })
}
