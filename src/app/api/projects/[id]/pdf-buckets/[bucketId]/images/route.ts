import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'generated-images'

async function verifyBucketOwnership(bucketId: string, userId: string) {
  return prisma.pdfBucket.findFirst({
    where: { id: bucketId, userId },
    select: { id: true, projectId: true, userId: true },
  })
}

/**
 * GET /api/projects/[id]/pdf-buckets/[bucketId]/images
 * List all images in a PDF bucket.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; bucketId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const bucket = await verifyBucketOwnership(params.bucketId, user.id)
    if (!bucket) {
      return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })
    }

    const images = await prisma.pdfBucketImage.findMany({
      where: { bucketId: params.bucketId },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({ images })
  } catch (error: any) {
    console.error('GET pdf-bucket images error:', error)
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 })
  }
}

/**
 * POST /api/projects/[id]/pdf-buckets/[bucketId]/images
 * Upload extracted images from client-side PDF parsing.
 * Accepts multipart form data with one or more image files.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; bucketId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const bucket = await verifyBucketOwnership(params.bucketId, user.id)
    if (!bucket) {
      return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const files = formData.getAll('images') as File[]
    const pageIndices = formData.getAll('pageIndices') as string[]
    const sources = formData.getAll('sources') as string[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 })
    }

    const existingCount = await prisma.pdfBucketImage.count({
      where: { bucketId: params.bucketId },
    })

    const uploaded: Array<{
      id: string
      imageUrl: string
      storagePath: string
      width: number | null
      height: number | null
      pageIndex: number | null
      sortOrder: number
      source: string
    }> = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) continue

      const timestamp = Date.now()
      const randomId = Math.random().toString(36).slice(2, 8)
      const extension = file.type.includes('png') ? 'png' : 'jpg'
      const storagePath = `pdf-buckets/${user.id}/${params.id}/${params.bucketId}/${timestamp}-${randomId}.${extension}`

      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: true,
        })

      if (uploadError) {
        console.error('Failed to upload pdf bucket image:', uploadError)
        continue
      }

      const { data: publicUrlData } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(storagePath)

      const pageIndex = pageIndices[i] ? parseInt(pageIndices[i], 10) : null
      const source = sources[i] || 'embedded'
      const sortOrder = existingCount + i

      const record = await prisma.pdfBucketImage.create({
        data: {
          bucketId: params.bucketId,
          imageUrl: publicUrlData.publicUrl,
          storagePath,
          pageIndex: isNaN(pageIndex as number) ? null : pageIndex,
          sortOrder,
          source,
        },
      })

      uploaded.push({
        id: record.id,
        imageUrl: publicUrlData.publicUrl,
        storagePath,
        width: null,
        height: null,
        pageIndex,
        sortOrder,
        source,
      })
    }

    return NextResponse.json({ images: uploaded, count: uploaded.length })
  } catch (error: any) {
    console.error('POST pdf-bucket images error:', error)
    return NextResponse.json({ error: 'Failed to upload images' }, { status: 500 })
  }
}
