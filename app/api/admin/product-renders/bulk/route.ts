import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'

const PRODUCT_RENDERS_BUCKET = 'product-renders'

interface BulkUploadImage {
  id: string // temporary client ID
  base64: string // data URL
  colorway: string
  angle?: string
  sortOrder?: number
}

/**
 * POST /api/admin/product-renders/bulk
 * 
 * Bulk upload multiple product render images at once
 * 
 * Body:
 *   - productName: Product name / category (required)
 *   - images: Array of { id, base64, colorway, angle?, sortOrder? }
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
    const { productName, images } = body as { 
      productName: string
      images: BulkUploadImage[] 
    }

    if (!productName) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    }

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 })
    }

    if (images.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 images per batch' }, { status: 400 })
    }

    console.log(`[bulk-upload] Uploading ${images.length} images for product: ${productName}`)

    const results: Array<{
      id: string
      success: boolean
      error?: string
      render?: any
    }> = []

    // Sanitize product name for file path
    const safeName = productName.toLowerCase().replace(/[^a-z0-9]/g, '-')

    // Process images sequentially to avoid overwhelming storage
    for (let i = 0; i < images.length; i++) {
      const image = images[i]
      
      try {
        if (!image.base64 || !image.base64.startsWith('data:')) {
          results.push({
            id: image.id,
            success: false,
            error: 'Invalid image data',
          })
          continue
        }

        // Sanitize colorway for file path
        const safeColorway = (image.colorway || 'default').toLowerCase().replace(/[^a-z0-9]/g, '-')
        const safeAngle = (image.angle || 'view').toLowerCase().replace(/[^a-z0-9]/g, '-')
        const timestamp = Date.now()
        const extension = image.base64.includes('png') ? 'png' : 'jpg'
        
        const storagePath = `products/${safeName}/${safeColorway}/${safeAngle}-${timestamp}.${extension}`

        // Upload to storage
        const imageUrl = await uploadBase64ToStorage(
          image.base64,
          PRODUCT_RENDERS_BUCKET,
          storagePath
        )

        // Create database record
        const render = await prisma.productRender.create({
          data: {
            name: productName,
            colorway: image.colorway || null,
            angle: image.angle || null,
            sortOrder: image.sortOrder ?? i,
            imageUrl,
            storagePath,
            source: 'local',
          },
        })

        results.push({
          id: image.id,
          success: true,
          render,
        })

        console.log(`[bulk-upload] Uploaded ${i + 1}/${images.length}: ${image.colorway || 'default'} - ${image.angle || 'view'}`)
      } catch (error: any) {
        console.error(`[bulk-upload] Failed to upload image ${image.id}:`, error)
        results.push({
          id: image.id,
          success: false,
          error: error.message || 'Upload failed',
        })
      }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log(`[bulk-upload] Complete: ${successful} succeeded, ${failed} failed`)

    return NextResponse.json({
      results,
      summary: {
        total: images.length,
        successful,
        failed,
      },
    })
  } catch (error: any) {
    console.error('[bulk-upload] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Bulk upload failed' },
      { status: 500 }
    )
  }
}

