import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { CMF_STORAGE_BUCKET, clownStoragePath } from '@/lib/cmf/storage'
import { getCmfProduct } from '@/lib/cmf/products'
import { requireAuthenticatedProfile, requireCmfWrite } from '@/lib/cmf/service'

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
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
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
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'file must be an image' }, { status: 400 })
  }
  if (!productSlug) {
    return NextResponse.json({ error: 'productSlug is required' }, { status: 400 })
  }
  if (!getCmfProduct(productSlug)) {
    return NextResponse.json(
      { error: `unknown productSlug "${productSlug}"` },
      { status: 400 }
    )
  }
  if (!SLUG_REGEX.test(variantSlug)) {
    return NextResponse.json(
      { error: 'variantSlug must be lowercase letters, digits, or dashes' },
      { status: 400 }
    )
  }
  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }

  let components: Array<z.infer<typeof ComponentSchema>> = []
  if (componentsRaw) {
    try {
      const parsed = JSON.parse(componentsRaw)
      const result = z.array(ComponentSchema).safeParse(parsed)
      if (!result.success) {
        return NextResponse.json(
          { error: 'Invalid components', details: result.error.issues },
          { status: 400 }
        )
      }
      components = result.data
    } catch {
      return NextResponse.json({ error: 'components must be valid JSON' }, { status: 400 })
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
