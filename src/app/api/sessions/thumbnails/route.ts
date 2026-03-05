import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

/**
 * GET /api/sessions/thumbnails?projectId=xxx&type=image|video
 * 
 * Returns a map of sessionId -> thumbnailUrl for all accessible sessions in a project.
 * This replaces the N sequential per-session thumbnail fetches with a single bulk request.
 * 
 * Response: { thumbnails: Record<sessionId, string | null> }
 */
export async function GET(request: NextRequest) {
  const startTime = performance.now()

  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get('projectId')
    const sessionType = searchParams.get('type') // 'image' or 'video' (optional filter)

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const userId = user.id

    // Verify user has access to this project and get ownership info
    // (owner, explicit member, or public project)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId: userId,
              },
            },
          },
          { isShared: true }, // Public project
        ],
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    const isOwner = project.ownerId === userId
    const showAllSessions = isOwner || project.isShared

    // Single SQL query to get thumbnails for all sessions
    // Uses LATERAL join to efficiently get the latest image per session
    // Excludes internal snapshot-capture records and video-model generations
    // whose outputs were incorrectly tagged as images
    const thumbnailRows = await prisma.$queryRaw<Array<{
      session_id: string
      thumbnail_url: string | null
    }>>(Prisma.sql`
      SELECT 
        s.id as session_id,
        thumb.file_url as thumbnail_url
      FROM sessions s
      LEFT JOIN LATERAL (
        SELECT o.file_url
        FROM generations g
        INNER JOIN outputs o ON o.generation_id = g.id
        WHERE g.session_id = s.id
          AND g.status = 'completed'
          AND o.file_type = 'image'
          AND g.model_id NOT IN ('snapshot-capture', 'kling-official', 'replicate-kling-2.6', 'gemini-veo-3.1')
        ORDER BY g.created_at DESC, o.created_at DESC
        LIMIT 1
      ) thumb ON TRUE
      WHERE s.project_id = ${projectId}::uuid
        AND (${showAllSessions}::boolean OR s.is_private = FALSE)
        AND (${sessionType === null}::boolean OR s.type = ${sessionType || ''})
      ORDER BY s.updated_at DESC
    `)

    // Convert to a Record<sessionId, thumbnailUrl>
    const thumbnails: Record<string, string | null> = {}
    for (const row of thumbnailRows) {
      thumbnails[row.session_id] = row.thumbnail_url
    }

    const duration = performance.now() - startTime
    logMetric({
      name: 'api_sessions_thumbnails',
      status: 'success',
      durationMs: duration,
      meta: {
        projectId,
        sessionType,
        sessionCount: thumbnailRows.length,
      },
    })

    return NextResponse.json(
      { thumbnails },
      {
        headers: {
          // Short cache - thumbnails can change when new generations complete
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
          'Server-Timing': `total;dur=${Math.round(duration)}`,
        },
      }
    )
  } catch (error: any) {
    const duration = performance.now() - startTime
    logMetric({
      name: 'api_sessions_thumbnails',
      status: 'error',
      durationMs: duration,
      meta: { error: error.message },
    })
    console.error('Error fetching session thumbnails:', error)
    return NextResponse.json(
      { error: 'Failed to fetch session thumbnails' },
      { status: 500 }
    )
  }
}
