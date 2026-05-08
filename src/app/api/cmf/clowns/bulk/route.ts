import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { CMF_STORAGE_BUCKET, clownStoragePath } from '@/lib/cmf/storage'
import { clownAssetFromZipEntry } from '@/lib/cmf/clown-zip-mapping'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // bulk uploads can take a while; raise from default 10s

/**
 * POST /api/cmf/clowns/bulk (multipart)
 *
 * Accepts one or more `.zip` files under the `files` field (repeated). Each
 * zip is interpreted via `clownAssetFromZipEntry` — the same mapping the
 * seed script uses — so designers can drop the canonical "Clown Renders"
 * pack and get every variant uploaded in one shot.
 *
 * Returns a per-entry report so the UI can show which assets landed and
 * which were skipped (unknown zip, duplicate variant, image read failure).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'No files provided. Use the "files" field (repeated) with .zip uploads.' },
      { status: 400 }
    )
  }

  type EntryResult = {
    zip: string
    inner: string
    productSlug: string | null
    variantSlug: string | null
    status: 'uploaded' | 'replaced' | 'skipped' | 'error'
    message?: string
  }

  const results: EntryResult[] = []
  let uploaded = 0
  let replaced = 0
  let skipped = 0

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      results.push({
        zip: file.name,
        inner: '',
        productSlug: null,
        variantSlug: null,
        status: 'skipped',
        message: 'not a .zip file',
      })
      skipped += 1
      continue
    }

    let zip: JSZip
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      zip = await JSZip.loadAsync(buffer)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unable to read zip'
      results.push({
        zip: file.name,
        inner: '',
        productSlug: null,
        variantSlug: null,
        status: 'error',
        message,
      })
      continue
    }

    // Iterate the entries. Skip directories and anything that's not a PNG/JPG.
    const entries = Object.values(zip.files).filter((e) => !e.dir)
    for (const entry of entries) {
      const inner = entry.name.split('/').pop() ?? entry.name
      if (!/\.(png|jpe?g)$/i.test(inner)) {
        results.push({
          zip: file.name,
          inner,
          productSlug: null,
          variantSlug: null,
          status: 'skipped',
          message: 'not a png/jpg',
        })
        skipped += 1
        continue
      }

      const match = clownAssetFromZipEntry(file.name, inner)
      if (!match) {
        results.push({
          zip: file.name,
          inner,
          productSlug: null,
          variantSlug: null,
          status: 'skipped',
          message: 'zip filename not in canonical mapping',
        })
        skipped += 1
        continue
      }

      try {
        const ext = /\.png$/i.test(inner) ? 'png' : 'jpg'
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
        const bytes = await entry.async('nodebuffer')
        const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
        const storagePath = clownStoragePath(match.productSlug, match.variantSlug, ext)
        const publicUrl = await uploadBase64ToStorage(
          dataUrl,
          CMF_STORAGE_BUCKET,
          storagePath
        )

        const existing = await prisma.cmfClownAsset.findUnique({
          where: {
            productSlug_variantSlug: {
              productSlug: match.productSlug,
              variantSlug: match.variantSlug,
            },
          },
          select: { id: true },
        })

        await prisma.cmfClownAsset.upsert({
          where: {
            productSlug_variantSlug: {
              productSlug: match.productSlug,
              variantSlug: match.variantSlug,
            },
          },
          create: {
            ownerId: auth.profile.userId,
            productSlug: match.productSlug,
            variantSlug: match.variantSlug,
            label: match.label,
            imageUrl: publicUrl,
            storagePath,
            components: [] as unknown as object,
          },
          update: {
            ownerId: auth.profile.userId,
            label: match.label,
            imageUrl: publicUrl,
            storagePath,
          },
        })

        if (existing) {
          replaced += 1
          results.push({
            zip: file.name,
            inner,
            productSlug: match.productSlug,
            variantSlug: match.variantSlug,
            status: 'replaced',
          })
        } else {
          uploaded += 1
          results.push({
            zip: file.name,
            inner,
            productSlug: match.productSlug,
            variantSlug: match.variantSlug,
            status: 'uploaded',
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'upload failed'
        results.push({
          zip: file.name,
          inner,
          productSlug: match.productSlug,
          variantSlug: match.variantSlug,
          status: 'error',
          message,
        })
      }
    }
  }

  return NextResponse.json({
    summary: { uploaded, replaced, skipped, total: results.length },
    results,
  })
}
