import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// GET /api/projects/:id/images - Get all images for a project (optimized single query)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id

    // Verify user has access to this project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    // Fetch all image outputs from image sessions in one optimized query
    const outputs = await prisma.output.findMany({
      where: {
        generation: {
          session: {
            projectId,
            type: 'image',
          },
        },
        fileType: 'image',
      },
      select: {
        id: true,
        fileUrl: true,
        width: true,
        height: true,
        createdAt: true,
        generation: {
          select: {
            id: true,
            prompt: true,
            modelId: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 200, // Limit to 200 most recent images
    })

    // Transform to simpler format
    const images = outputs.map((output) => ({
      id: output.id,
      url: output.fileUrl,
      prompt: output.generation.prompt,
      generationId: output.generation.id,
      width: output.width,
      height: output.height,
      createdAt: output.createdAt,
    }))

    return NextResponse.json(images)
  } catch (error) {
    console.error('Error fetching project images:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project images' },
      { status: 500 }
    )
  }
}

