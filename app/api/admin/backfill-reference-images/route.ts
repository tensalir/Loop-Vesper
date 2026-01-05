import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { persistReferenceImage, persistReferenceImages } from '@/lib/reference-images'
import { Prisma } from '@prisma/client'

/**
 * Admin endpoint to backfill existing generations that have base64 reference images
 * stored in their parameters. This uploads them to storage and replaces the base64
 * with public URLs.
 * 
 * Auth: Requires x-internal-secret header matching INTERNAL_API_SECRET env var
 * 
 * Query params:
 *   - limit: Number of generations to process per batch (default: 20)
 *   - cursor: Last processed generation ID for pagination
 * 
 * Response:
 *   - processed: Total generations examined
 *   - updated: Generations that had base64 migrated
 *   - skipped: Generations that didn't need migration
 *   - errors: Array of {id, error} for failed migrations
 *   - nextCursor: ID of last processed generation (for next batch)
 */
export async function POST(request: NextRequest) {
  // Auth check
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'INTERNAL_API_SECRET not configured' },
      { status: 500 }
    )
  }

  if (!internalSecret || internalSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '20')
  const cursor = searchParams.get('cursor')

  const results = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [] as Array<{ id: string; error: string }>,
    nextCursor: null as string | null,
  }

  try {
    // Fetch batch of generations
    const generations = await prisma.generation.findMany({
      where: {
        // All generations have parameters (required field)
      },
      select: {
        id: true,
        userId: true,
        parameters: true,
      },
      take: limit,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      orderBy: { createdAt: 'asc' },
    })

    for (const gen of generations) {
      results.processed++
      results.nextCursor = gen.id

      const params = gen.parameters as Record<string, unknown> | null
      if (!params) {
        results.skipped++
        continue
      }

      // Check if this generation needs backfill
      const singleBase64 =
        typeof params.referenceImage === 'string' &&
        params.referenceImage.startsWith('data:')
      const multiBase64 =
        Array.isArray(params.referenceImages) &&
        params.referenceImages.some(
          (img: unknown) => typeof img === 'string' && (img as string).startsWith('data:')
        )

      // Skip if no base64 data found
      if (!singleBase64 && !multiBase64) {
        results.skipped++
        continue
      }

      // Skip if already has URL pointer and no base64 (idempotency)
      const hasUrlPointer =
        typeof params.referenceImageUrl === 'string' &&
        params.referenceImageUrl.startsWith('http')
      if (hasUrlPointer && !singleBase64 && !multiBase64) {
        results.skipped++
        continue
      }

      try {
        const newParams = { ...params }

        // Handle single reference image
        if (singleBase64) {
          const pointer = await persistReferenceImage(
            params.referenceImage as string,
            gen.userId,
            `backfill-${gen.id}`
          )
          // Remove base64, add pointer fields
          delete newParams.referenceImage
          newParams.referenceImageUrl = pointer.referenceImageUrl
          newParams.referenceImageId = pointer.referenceImageId
          newParams.referenceImagePath = pointer.referenceImagePath
          newParams.referenceImageBucket = pointer.referenceImageBucket
          newParams.referenceImageMimeType = pointer.referenceImageMimeType
          newParams.referenceImageChecksum = pointer.referenceImageChecksum
        }

        // Handle multiple reference images
        if (multiBase64) {
          const currentImages = params.referenceImages as string[]
          const base64Images = currentImages.filter((img) => img.startsWith('data:'))
          const existingUrls = currentImages.filter((img) => img.startsWith('http'))

          if (base64Images.length > 0) {
            const uploadedUrls = await persistReferenceImages(
              base64Images,
              gen.userId,
              `backfill-${gen.id}`
            )
            // Replace with only URLs (no base64)
            newParams.referenceImages = [...existingUrls, ...uploadedUrls]
          }
        }

        // Update the generation with cleaned parameters
        await prisma.generation.update({
          where: { id: gen.id },
          data: { parameters: newParams as Prisma.InputJsonValue },
        })

        results.updated++
        console.log(`[backfill] Migrated generation ${gen.id}`)
      } catch (error: any) {
        console.error(`[backfill] Failed to migrate generation ${gen.id}:`, error)
        results.errors.push({
          id: gen.id,
          error: error.message || 'Unknown error',
        })
      }
    }

    return NextResponse.json(results)
  } catch (error: any) {
    console.error('[backfill] Batch processing error:', error)
    return NextResponse.json(
      {
        ...results,
        error: error.message || 'Batch processing failed',
      },
      { status: 500 }
    )
  }
}

