import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function verifyBucketOwnership(bucketId: string, userId: string) {
  return prisma.pdfBucket.findFirst({
    where: { id: bucketId, userId },
    select: { id: true, projectId: true },
  })
}

/**
 * PATCH /api/projects/[id]/pdf-buckets/[bucketId]
 * Update bucket status (e.g. mark completed/failed after extraction).
 */
export async function PATCH(
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

    const body = await request.json()
    const { status, pageCount, error: errorMsg } = body

    const updated = await prisma.pdfBucket.update({
      where: { id: params.bucketId },
      data: {
        ...(status && { status }),
        ...(pageCount !== undefined && { pageCount }),
        ...(errorMsg !== undefined && { error: errorMsg }),
      },
    })

    return NextResponse.json({ bucket: updated })
  } catch (error: any) {
    console.error('PATCH pdf-bucket error:', error)
    return NextResponse.json({ error: 'Failed to update bucket' }, { status: 500 })
  }
}

/**
 * DELETE /api/projects/[id]/pdf-buckets/[bucketId]
 * Delete a bucket and all its images.
 */
export async function DELETE(
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

    await prisma.pdfBucket.delete({ where: { id: params.bucketId } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE pdf-bucket error:', error)
    return NextResponse.json({ error: 'Failed to delete bucket' }, { status: 500 })
  }
}
