import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'

const PRODUCT_RENDERS_BUCKET = 'product-renders'

/**
 * POST /api/admin/product-renders
 * 
 * Create a new product render (admin only)
 * 
 * Body:
 *   - name: Product name (required)
 *   - colorway: Colorway/variant (optional)
 *   - image: Base64 data URL of the image (required for local uploads)
 *   - imageUrl: External URL (optional, for Frontify synced items)
 *   - frontifyId: Frontify asset ID (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { name, colorway, image, imageUrl, frontifyId } = body

    if (!name) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    }

    if (!image && !imageUrl) {
      return NextResponse.json({ error: 'Either image (base64) or imageUrl is required' }, { status: 400 })
    }

    let finalImageUrl = imageUrl
    let storagePath: string | null = null

    // If base64 image provided, upload to Supabase storage
    if (image && image.startsWith('data:')) {
      // Sanitize name for file path
      const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '-')
      const safeColorway = colorway ? colorway.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'default'
      const timestamp = Date.now()
      const extension = image.includes('png') ? 'png' : 'jpg'
      
      storagePath = `products/${safeName}/${safeColorway}-${timestamp}.${extension}`
      
      try {
        finalImageUrl = await uploadBase64ToStorage(image, PRODUCT_RENDERS_BUCKET, storagePath)
      } catch (uploadError: any) {
        console.error('[admin/product-renders] Upload error:', uploadError)
        return NextResponse.json(
          { error: `Failed to upload image: ${uploadError.message}` },
          { status: 500 }
        )
      }
    }

    // Create the product render record
    const productRender = await prisma.productRender.create({
      data: {
        name,
        colorway: colorway || null,
        imageUrl: finalImageUrl,
        storagePath,
        source: frontifyId ? 'frontify' : 'local',
        frontifyId: frontifyId || null,
      },
    })

    return NextResponse.json(productRender, { status: 201 })
  } catch (error: any) {
    console.error('[admin/product-renders] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create product render' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/admin/product-renders
 * 
 * List all product renders for admin management (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const renders = await prisma.productRender.findMany({
      orderBy: [
        { name: 'asc' },
        { colorway: 'asc' },
      ],
    })

    // Get unique product names
    const productNames = Array.from(new Set(renders.map(r => r.name))).sort()

    return NextResponse.json({
      renders,
      productNames,
      total: renders.length,
    })
  } catch (error: any) {
    console.error('[admin/product-renders] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch product renders' },
      { status: 500 }
    )
  }
}

