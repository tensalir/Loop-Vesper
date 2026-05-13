import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { CMF_STORAGE_BUCKET, clownStoragePath } from '@/lib/cmf/storage'
import { getCmfProduct } from '@/lib/cmf/products'
import { requireAuthenticatedProfile, requireCmfWrite } from '@/lib/cmf/service'
import { cmfError } from '@/lib/cmf/api'

export const dynamic = 'force-dynamic'

/**
 * Clown reference library — global as of 20260508.
 *
 * GET is open to any authenticated profile and returns every canonical clown.
 * POST still requires auth (the contributor is recorded on `ownerId` for
 * audit), but the upsert key is now `(productSlug, variantSlug)` only — any
 * teammate can replace a clown when a better reference becomes available.
 */

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/

/**
 * Per-image cap. Loop's clown PNGs are typically 1-3 MB; 5 MB leaves
 * headroom for occasional 4K reference shots without inviting "I just
 * uploaded my entire desktop wallpaper folder" mistakes. Mirrors the
 * 8 MB / 10 MB ceilings on the refinement-references and import
 * routes — same scale of "single artefact upload".
 */
const MAX_CLOWN_IMAGE_BYTES = 5 * 1024 * 1024

const ComponentSchema = z.object({
  region: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  colorHex: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/i)
    .transform((v) => (v.startsWith('#') ? v : `#${v}`))
    .optional(),
})

/**
 * GET /api/cmf/clowns?productSlug=
 *
 * Returns the shared clown library for the workspace, optionally filtered
 * to a single product. Auth-gated to keep the asset URLs out of unindexed
 * crawlers but otherwise unscoped.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const url = new URL(request.url)
  const productSlug = url.searchParams.get('productSlug') || undefined

  const assets = await prisma.cmfClownAsset.findMany({
    where: productSlug ? { productSlug: productSlug.toLowerCase() } : undefined,
    orderBy: [{ productSlug: 'asc' }, { variantSlug: 'asc' }, { label: 'asc' }],
  })

  return NextResponse.json({ assets })
}

/**
 * POST /api/cmf/clowns (multipart)
 *
 * Fields:
 *   - file: PNG/JPG of the clown reference (required)
 *   - productSlug, variantSlug, label
 *   - components: optional JSON array (parsed if a string)
 *
 * Upserts on `(productSlug, variantSlug)` so re-uploading replaces the
 * canonical reference for that variant. The caller is recorded as
 * `ownerId` purely for audit ("who last touched this asset").
 */
export async function POST(request: NextRequest) {
  // Clown reference uploads mutate the global library — gate on CMF
  // write access. The audit `ownerId` still records the contributor.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return cmfError('Invalid multipart body')
  }

  const file = formData.get('file') as File | null
  const productSlug = ((formData.get('productSlug') as string | null) || '')
    .trim()
    .toLowerCase()
  const variantSlug =
    ((formData.get('variantSlug') as string | null) || 'default')
      .trim()
      .toLowerCase() || 'default'
  const label = ((formData.get('label') as string | null) || '').trim()
  const componentsRaw = formData.get('components') as string | null

  if (!file) {
    return cmfError('file is required')
  }
  if (!file.type.startsWith('image/')) {
    return cmfError('file must be an image')
  }
  if (file.size > MAX_CLOWN_IMAGE_BYTES) {
    return cmfError(
      `Image too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Max is ${MAX_CLOWN_IMAGE_BYTES / 1024 / 1024} MB.`,
      { status: 413 }
    )
  }
  if (!productSlug) {
    return cmfError('productSlug is required')
  }
  if (!getCmfProduct(productSlug)) {
    return cmfError(`unknown productSlug "${productSlug}"`)
  }
  if (!SLUG_REGEX.test(variantSlug)) {
    return cmfError('variantSlug must be lowercase letters, digits, or dashes')
  }
  if (!label) {
    return cmfError('label is required')
  }

  let components: Array<z.infer<typeof ComponentSchema>> = []
  if (componentsRaw) {
    try {
      const parsed = JSON.parse(componentsRaw)
      const result = z.array(ComponentSchema).safeParse(parsed)
      if (!result.success) {
        return cmfError('Invalid components', {
          details: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        })
      }
      components = result.data
    } catch {
      return cmfError('components must be valid JSON')
    }
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const ext = file.type.includes('png') ? 'png' : 'jpg'
  const storagePath = clownStoragePath(productSlug, variantSlug, ext)
  const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`
  const publicUrl = await uploadBase64ToStorage(dataUrl, CMF_STORAGE_BUCKET, storagePath)

  const asset = await prisma.cmfClownAsset.upsert({
    where: {
      productSlug_variantSlug: { productSlug, variantSlug },
    },
    create: {
      ownerId: auth.profile.userId,
      productSlug,
      variantSlug,
      label,
      imageUrl: publicUrl,
      storagePath,
      components: components as unknown as object,
    },
    update: {
      ownerId: auth.profile.userId,
      label,
      imageUrl: publicUrl,
      storagePath,
      components: components as unknown as object,
    },
  })

  return NextResponse.json({ asset })
}
