import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// Allowlist of parameter fields that the UI needs
// All other fields (debugLogs, base64 blobs, internal state) are stripped by default
const ALLOWED_PARAMETER_FIELDS = [
  // Generation settings (required by UI)
  'aspectRatio',
  'numOutputs',
  'resolution',
  'duration',

  // Error display
  'error',

  // Reference image pointers (for thumbnails + reuse)
  'referenceImageUrl',
  'referenceImageId',
  'referenceImagePath',
  'referenceImageBucket',
  'referenceImageMimeType',
  'referenceImageChecksum',

  // Multi-image support (URLs only, base64 stripped in sanitize function)
  'referenceImages',

  // Animate-still: links video generations to source image output
  'sourceOutputId',
]

/**
 * Sanitize generation parameters to remove large/debug data.
 * Uses an allowlist approach - only explicitly allowed fields are kept.
 * For referenceImages, filters to only keep HTTP URLs (strips base64).
 */
function sanitizeParameters(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}

  const input = params as Record<string, unknown>
  const sanitized: Record<string, unknown> = {}

  for (const key of ALLOWED_PARAMETER_FIELDS) {
    if (key in input) {
      if (key === 'referenceImages' && Array.isArray(input[key])) {
        // Strip base64 data URLs, keep only HTTP URLs
        const filtered = (input[key] as unknown[]).filter(
          (img: unknown) => typeof img === 'string' && img.startsWith('http')
        )
        if (filtered.length > 0) {
          sanitized[key] = filtered
        }
      } else {
        sanitized[key] = input[key]
      }
    }
  }

  return sanitized
}

// Helper to encode cursor as base64url
function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ createdAt: createdAt.toISOString(), id })
  return Buffer.from(payload).toString('base64url')
}

// Helper to decode cursor from base64url
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const payload = Buffer.from(cursor, 'base64url').toString('utf-8')
    const parsed = JSON.parse(payload)
    return {
      createdAt: new Date(parsed.createdAt),
      id: parsed.id,
    }
  } catch {
    return null
  }
}

// GET /api/generations?sessionId=xxx&cursor=xxx - Get generations for a session with cursor pagination
// Returns newest-first using keyset pagination based on (createdAt, id)
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const cursor = searchParams.get('cursor')
    const limit = parseInt(searchParams.get('limit') || '10') // Default to 10 for infinite scroll
    // Debug mode: include full parameters (for admin/debugging)
    const includeParameters = searchParams.get('includeParameters') === 'true'

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    // Build base where clause
    const baseWhere: any = {
      sessionId,
      userId: session.user.id, // Only fetch user's own generations
    }

    // Add keyset cursor for pagination (newest-first: createdAt DESC, id DESC)
    // To get the next page, we need items where:
    // (createdAt < cursorCreatedAt) OR (createdAt == cursorCreatedAt AND id < cursorId)
    let whereClause: any = baseWhere
    if (cursor) {
      const decoded = decodeCursor(cursor)
      if (decoded) {
        whereClause = {
          ...baseWhere,
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            {
              AND: [
                { createdAt: decoded.createdAt },
                { id: { lt: decoded.id } },
              ],
            },
          ],
        }
      }
    }

    // Fetch generations with their outputs and user profile
    // Order by createdAt DESC, id DESC (newest first)
    const generations = await prisma.generations.findMany({
      where: whereClause,
      select: {
        id: true,
        sessionId: true,
        userId: true,
        modelId: true,
        prompt: true,
        negativePrompt: true,
        parameters: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        outputs: {
          select: {
            id: true,
            generationId: true,
            fileUrl: true,
            fileType: true,
            width: true,
            height: true,
            duration: true,
            isStarred: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
      },
    },
      orderBy: [
        { createdAt: 'desc' }, // Newest first
        { id: 'desc' }, // Tie-breaker for UUID stability
      ],
    take: limit + 1, // Fetch one extra to check if there's more
  })

    // Check if there's more data
    const hasMore = generations.length > limit
    const data = hasMore ? generations.slice(0, limit) : generations
    
    // Build next cursor from the last item in the returned page
    const lastItem = data[data.length - 1]
    const nextCursor = hasMore && lastItem 
      ? encodeCursor(lastItem.createdAt, lastItem.id) 
      : undefined

    // Fetch bookmarks separately for efficiency
    const outputIds = data.flatMap((g: any) => g.outputs.map((o: any) => o.id))
    const bookmarks = outputIds.length > 0
      ? await (prisma as any).bookmark.findMany({
          where: {
            outputId: { in: outputIds },
            userId: session.user.id,
          },
          select: {
            outputId: true,
          },
        })
      : []

    const bookmarkedOutputIds = new Set(bookmarks.map((b: any) => b.outputId))

    // Add isBookmarked field to outputs and sanitize parameters
    const generationsWithBookmarks = data.map((generation: any) => ({
      ...generation,
      // Sanitize parameters by default; pass full parameters only in debug mode
      parameters: includeParameters
        ? generation.parameters
        : sanitizeParameters(generation.parameters),
      outputs: generation.outputs.map((output: any) => ({
        ...output,
        isBookmarked: bookmarkedOutputIds.has(output.id),
      })),
    }))

    return NextResponse.json({
      data: generationsWithBookmarks,
      nextCursor,
      hasMore,
    })
  } catch (error) {
    console.error('Error fetching generations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch generations' },
      { status: 500 }
    )
  }
}

