import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { fetchFrontifyAssets, isFrontifyConfigured } from '@/lib/frontify/client'

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
    const source = searchParams.get('source') || 'all'
    const nameFilter = searchParams.get('name') || undefined

    // Build where clause for local renders
    const where: any = {}
    
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

    // Fetch local renders from database
    const localRenders = source !== 'frontify' 
      ? await prisma.productRender.findMany({
          where,
          orderBy: [
            { name: 'asc' },
            { colorway: 'asc' },
          ],
        })
      : []

    // Fetch Frontify renders if configured and requested
    let frontifyRenders: any[] = []
    if (source !== 'local' && isFrontifyConfigured()) {
      try {
        const frontifyAssets = await fetchFrontifyAssets({ search })
        
        // Filter by name if specified
        frontifyRenders = nameFilter
          ? frontifyAssets.filter(a => a.name.toLowerCase() === nameFilter.toLowerCase())
          : frontifyAssets
        
        // Transform to match database format
        frontifyRenders = frontifyRenders.map(asset => ({
          id: `frontify-${asset.frontifyId}`,
          name: asset.name,
          colorway: asset.colorway,
          imageUrl: asset.imageUrl,
          storagePath: null,
          source: 'frontify',
          frontifyId: asset.frontifyId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }))
      } catch (error) {
        console.error('[product-renders] Frontify fetch error:', error)
        // Continue with local renders only
      }
    }

    // Combine results (local first, then frontify)
    // Deduplicate by frontifyId to avoid showing synced items twice
    const frontifyIds = new Set(localRenders.filter(r => r.frontifyId).map(r => r.frontifyId))
    const uniqueFrontifyRenders = frontifyRenders.filter(r => !frontifyIds.has(r.frontifyId))
    
    const allRenders = [...localRenders, ...uniqueFrontifyRenders]

    // Get unique product names for filter chips
    const productNames = Array.from(new Set(allRenders.map(r => r.name))).sort()

    return NextResponse.json({
      renders: allRenders,
      productNames,
      frontifyConfigured: isFrontifyConfigured(),
    })
  } catch (error: any) {
    console.error('[product-renders] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch product renders' },
      { status: 500 }
    )
  }
}

