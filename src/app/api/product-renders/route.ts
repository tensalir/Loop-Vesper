import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { fetchFrontifyAssets, isFrontifyConfigured, type ProductRenderFromFrontify } from '@/lib/frontify/client'
import { getFrontifyAccessTokenFromCookies } from '@/lib/frontify/oauth'

// Deprecated product models to filter out (Carry variants are Case type renders, not separate products)
const DEPRECATED_PRODUCTS = [
  'Engage', 'Experience', 'Quiet', 'Switch',
  'Dream Carry', 'Dream Lilac Carry', 'Dream Peach Carry'
]

// Simple in-memory TTL cache for Frontify results
// Key: search query (or empty string), Value: { data, timestamp }
const frontifyCache = new Map<string, { data: ProductRenderFromFrontify[]; timestamp: number }>()
const FRONTIFY_CACHE_TTL_MS = 3 * 60 * 1000 // 3 minutes

/**
 * Get cached Frontify assets or fetch fresh data
 */
async function getCachedFrontifyAssets(
  search: string | undefined,
  accessToken: string | null
): Promise<ProductRenderFromFrontify[]> {
  const tokenScope = accessToken ? accessToken.slice(-8) : 'env'
  const cacheKey = `${tokenScope}:${search || ''}`
  const now = Date.now()
  
  // Check cache
  const cached = frontifyCache.get(cacheKey)
  if (cached && (now - cached.timestamp) < FRONTIFY_CACHE_TTL_MS) {
    return cached.data
  }
  
  // Fetch fresh data
  const data = await fetchFrontifyAssets({ search, accessToken: accessToken ?? undefined })
  
  // Update cache
  frontifyCache.set(cacheKey, { data, timestamp: now })
  
  // Clean up old entries (simple eviction - keep max 20 entries)
  if (frontifyCache.size > 20) {
    const oldestKey = frontifyCache.keys().next().value
    if (oldestKey !== undefined) {
      frontifyCache.delete(oldestKey)
    }
  }
  
  return data
}

/**
 * GET /api/product-renders
 * 
 * List all product renders with optional search/filter
 * Combines local database renders with Frontify assets
 * 
 * Query params:
 *   - search: Search by product name
 *   - source: Filter by source ('local', 'frontify', 'all')
 *   - name: Filter by exact product name
 *   - type: Filter by render type ('single', 'pair', 'case', 'all')
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || undefined
    const frontifyAccessToken = getFrontifyAccessTokenFromCookies(cookies())
    const source = searchParams.get('source') || 'all'
    const nameFilter = searchParams.get('name') || undefined
    const typeFilter = searchParams.get('type') || undefined

    // Build where clause for local renders
    const where: Record<string, unknown> = {}
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { colorway: { contains: search, mode: 'insensitive' } },
      ]
    }
    
    if (nameFilter) {
      where.name = nameFilter
    }
    
    if (source !== 'all') {
      where.source = source
    }

    // Filter by render type (single, pair, case)
    if (typeFilter && typeFilter !== 'all') {
      where.renderType = typeFilter
    }

    // Determine what to fetch
    const shouldFetchLocal = source !== 'frontify'
    const skipFrontify = typeFilter && typeFilter !== 'all'
    const shouldFetchFrontify =
      source !== 'local' && !skipFrontify && isFrontifyConfigured(frontifyAccessToken)

    // Start both fetches in parallel (avoid waterfall)
    const localRendersPromise = shouldFetchLocal
      ? prisma.productRender.findMany({
          where,
          orderBy: [
            { name: 'asc' },
            { colorway: 'asc' },
            { sortOrder: 'asc' },
          ],
        })
      : Promise.resolve([])

    const frontifyAssetsPromise = shouldFetchFrontify
      ? getCachedFrontifyAssets(search, frontifyAccessToken).catch(error => {
          console.error('[product-renders] Frontify fetch error:', error)
          return [] as ProductRenderFromFrontify[]
        })
      : Promise.resolve([] as ProductRenderFromFrontify[])

    // Await both in parallel
    const [localRenders, frontifyAssets] = await Promise.all([
      localRendersPromise,
      frontifyAssetsPromise,
    ])

    // Process Frontify results
    let frontifyRenders = nameFilter
      ? frontifyAssets.filter(a => a.name.toLowerCase() === nameFilter.toLowerCase())
      : frontifyAssets

    // Transform to match database format
    const transformedFrontifyRenders = frontifyRenders.map(asset => ({
      id: `frontify-${asset.frontifyId}`,
      name: asset.name,
      colorway: asset.colorway,
      renderType: null,
      imageUrl: asset.imageUrl,
      storagePath: null,
      source: 'frontify' as const,
      frontifyId: asset.frontifyId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    // Combine results (local first, then frontify)
    // Deduplicate by frontifyId to avoid showing synced items twice
    const frontifyIds = new Set(localRenders.filter(r => r.frontifyId).map(r => r.frontifyId))
    const uniqueFrontifyRenders = transformedFrontifyRenders.filter(r => !frontifyIds.has(r.frontifyId))
    
    // Filter out deprecated products
    const allRenders = [...localRenders, ...uniqueFrontifyRenders]
      .filter(r => !DEPRECATED_PRODUCTS.includes(r.name))

    // Get unique product names for filter chips (excluding deprecated models)
    const productNames = Array.from(new Set(allRenders.map(r => r.name)))
      .filter(name => !DEPRECATED_PRODUCTS.includes(name))
      .sort()

    // Get unique render types for filter chips (from local renders only)
    const renderTypes = Array.from(
      new Set(localRenders.map(r => r.renderType).filter(Boolean))
    ).sort() as string[]

    // Create response with cache headers
    const response = NextResponse.json({
      renders: allRenders,
      productNames,
      renderTypes,
      frontifyConfigured: isFrontifyConfigured(),
      frontifyOAuthConnected: !!frontifyAccessToken,
    })

    // Add cache headers for browser/CDN caching
    // private: only cache in browser, not CDN (user-specific data)
    // max-age=60: cache for 60 seconds
    // stale-while-revalidate=300: serve stale for 5 minutes while revalidating
    response.headers.set(
      'Cache-Control',
      'private, max-age=60, stale-while-revalidate=300'
    )

    return response
  } catch (error: unknown) {
    console.error('[product-renders] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch product renders'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
