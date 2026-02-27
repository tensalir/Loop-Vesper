import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function checkProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
        { isShared: true },
      ],
    },
    select: { id: true },
  })
  return !!project
}

/**
 * GET /api/projects/[id]/pdf-buckets
 * List PDF buckets for the current user in this project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const hasAccess = await checkProjectAccess(projectId, user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const buckets = await prisma.pdfBucket.findMany({
      where: { projectId, userId: user.id },
      include: {
        _count: { select: { images: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ buckets })
  } catch (error: any) {
    console.error('GET /api/projects/[id]/pdf-buckets error:', error)
    return NextResponse.json({ error: 'Failed to list PDF buckets' }, { status: 500 })
  }
}

/**
 * POST /api/projects/[id]/pdf-buckets
 * Create a new PDF bucket (called after client-side extraction starts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const hasAccess = await checkProjectAccess(projectId, user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await request.json()
    const { fileName, storagePath, pageCount } = body

    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
    }

    const bucket = await prisma.pdfBucket.create({
      data: {
        projectId,
        userId: user.id,
        fileName,
        storagePath: storagePath || null,
        pageCount: pageCount || null,
        status: 'processing',
      },
    })

    return NextResponse.json({ bucket })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/pdf-buckets error:', error)
    return NextResponse.json({ error: 'Failed to create PDF bucket' }, { status: 500 })
  }
}
