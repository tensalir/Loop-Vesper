import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/bookmarks - Create a bookmark
export async function POST(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { outputId } = await request.json()

    if (!outputId) {
      return NextResponse.json({ error: 'outputId is required' }, { status: 400 })
    }

    // Check if bookmark already exists
    const existing = await prisma.bookmark.findUnique({
      where: {
        userId_outputId: {
          userId: user.id,
          outputId: outputId,
        },
      },
    })

    if (existing) {
      return NextResponse.json({ error: 'Bookmark already exists' }, { status: 400 })
    }

    // Create bookmark
    const bookmark = await prisma.bookmark.create({
      data: {
        userId: user.id,
        outputId: outputId,
      },
    })

    return NextResponse.json(bookmark)
  } catch (error) {
    console.error('Error creating bookmark:', error)
    return NextResponse.json({ error: 'Failed to create bookmark' }, { status: 500 })
  }
}

// DELETE /api/bookmarks - Remove a bookmark
export async function DELETE(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { outputId } = await request.json()

    if (!outputId) {
      return NextResponse.json({ error: 'outputId is required' }, { status: 400 })
    }

    // Delete bookmark
    await prisma.bookmark.delete({
      where: {
        userId_outputId: {
          userId: user.id,
          outputId: outputId,
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting bookmark:', error)
    return NextResponse.json({ error: 'Failed to delete bookmark' }, { status: 500 })
  }
}

// GET /api/bookmarks - Get all bookmarks for current user
export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const bookmarks = await prisma.bookmark.findMany({
      where: {
        userId: user.id,
      },
      include: {
        output: {
          include: {
            generation: {
              include: {
                session: {
                  include: {
                    project: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(bookmarks)
  } catch (error) {
    console.error('Error fetching bookmarks:', error)
    return NextResponse.json({ error: 'Failed to fetch bookmarks' }, { status: 500 })
  }
}

