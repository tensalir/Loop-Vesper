import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

/**
 * Optimized endpoint to fetch projects with thumbnails using a single SQL query
 * 
 * Features:
 * - Single parameterized SQL query for predictable cost
 * - Keyset pagination over (updated_at, id) for stable pagination
 * - LATERAL subqueries for efficient per-project aggregations
 * - Respects session visibility (owner sees all, members see public only)
 * 
 * Query params:
 * - limit: number of projects to return (default 20, max 50)
 * - cursor: keyset cursor in format "updated_at,id" for pagination
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

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)
    const cursorParam = searchParams.get('cursor')
    
    // Parse keyset cursor (format: "updated_at,id")
    let cursorUpdatedAt: Date | null = null
    let cursorId: string | null = null
    if (cursorParam) {
      const [updatedAtStr, id] = cursorParam.split(',')
      cursorUpdatedAt = new Date(updatedAtStr)
      cursorId = id
    }

    // Ensure user profile exists (create if it doesn't)
    await prisma.profile.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        username: user.email?.split('@')[0],
        displayName: user.user_metadata?.full_name || user.email,
      },
    })

    const userId = user.id

    // Single optimized SQL query using LATERAL joins
    // This fetches projects with owner, session count, and latest thumbnail in one query
    const projects = await prisma.$queryRaw<Array<{
      id: string
      name: string
      description: string | null
      owner_id: string
      is_shared: boolean
      created_at: Date
      updated_at: Date
      owner_display_name: string | null
      owner_username: string | null
      session_count: bigint
      thumbnail_url: string | null
    }>>(Prisma.sql`
      WITH accessible_projects AS (
        -- Projects the user owns
        SELECT p.id, p.name, p.description, p.owner_id, p.is_shared, 
               p.created_at, p.updated_at, TRUE as is_owner
        FROM projects p
        WHERE p.owner_id = ${userId}::uuid
        
        UNION
        
        -- Projects the user is explicitly a member of
        SELECT p.id, p.name, p.description, p.owner_id, p.is_shared,
               p.created_at, p.updated_at, FALSE as is_owner
        FROM projects p
        INNER JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ${userId}::uuid
        
        UNION
        
        -- Public shared projects from other users
        SELECT p.id, p.name, p.description, p.owner_id, p.is_shared,
               p.created_at, p.updated_at, FALSE as is_owner
        FROM projects p
        WHERE p.is_shared = TRUE
          AND p.owner_id != ${userId}::uuid
      )
      SELECT 
        ap.id,
        ap.name,
        ap.description,
        ap.owner_id,
        ap.is_shared,
        ap.created_at,
        ap.updated_at,
        pr.display_name as owner_display_name,
        pr.username as owner_username,
        COALESCE(sc.session_count, 0) as session_count,
        thumb.file_url as thumbnail_url
      FROM accessible_projects ap
      -- Owner profile
      LEFT JOIN profiles pr ON ap.owner_id = pr.id
      -- Session count (respecting visibility: owner sees all, member sees public)
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as session_count
        FROM sessions s
        WHERE s.project_id = ap.id
          AND (ap.is_owner = TRUE OR s.is_private = FALSE)
      ) sc ON TRUE
      -- Latest image thumbnail (from visible sessions only)
      LEFT JOIN LATERAL (
        SELECT o.file_url
        FROM sessions s
        INNER JOIN generations g ON g.session_id = s.id
        INNER JOIN outputs o ON o.generation_id = g.id
        WHERE s.project_id = ap.id
          AND (ap.is_owner = TRUE OR s.is_private = FALSE)
          AND g.status = 'completed'
          AND o.file_type = 'image'
        ORDER BY g.created_at DESC, o.created_at DESC
        LIMIT 1
      ) thumb ON TRUE
      WHERE (
        ${cursorUpdatedAt === null}::boolean
        OR (ap.updated_at, ap.id) < (${cursorUpdatedAt || new Date()}::timestamptz, ${cursorId || ''}::uuid)
      )
      ORDER BY ap.updated_at DESC, ap.id DESC
      LIMIT ${limit + 1}
    `)

    // Check if there are more results
    const hasMore = projects.length > limit
    const resultProjects = hasMore ? projects.slice(0, limit) : projects
    
    // Build next cursor
    let nextCursor: string | null = null
    if (hasMore && resultProjects.length > 0) {
      const lastProject = resultProjects[resultProjects.length - 1]
      nextCursor = `${lastProject.updated_at.toISOString()},${lastProject.id}`
    }

    // Transform to expected response shape
    const projectsWithThumbnails = resultProjects.map(project => ({
      id: project.id,
      name: project.name,
      description: project.description,
      ownerId: project.owner_id,
      isShared: project.is_shared,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      owner: {
        id: project.owner_id,
        displayName: project.owner_display_name,
        username: project.owner_username,
      },
      thumbnailUrl: project.thumbnail_url,
      sessionCount: Number(project.session_count),
    }))

    logMetric({
      name: 'api_projects_with_thumbnails',
      status: 'success',
      durationMs: performance.now() - startTime,
      meta: {
        projectCount: projectsWithThumbnails.length,
        hasMore,
        hasCursor: !!cursorParam,
      },
    })

    // IMPORTANT:
    // The projects overview must reflect deletes/updates immediately.
    // React Query already provides in-app caching; HTTP caching here can serve stale
    // data after a mutation (e.g. delete) and make the UI look "stuck" until the
    // browser cache expires.
    return NextResponse.json(
      {
        data: projectsWithThumbnails,
        nextCursor,
        hasMore,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error: any) {
    logMetric({
      name: 'api_projects_with_thumbnails',
      status: 'error',
      durationMs: performance.now() - startTime,
      meta: { error: error.message },
    })
    console.error('Error fetching projects with thumbnails:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch projects',
        details: error.message,
        code: error.code
      },
      { status: 500 }
    )
  }
}
