import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { deleteFromStorage, uploadBase64ToStorage } from '@/lib/supabase/storage'

const PRODUCT_RENDERS_BUCKET = 'product-renders'

/**
 * PUT /api/admin/product-renders/[id]
 * 
 * Update a product render (admin only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params
    const body = await request.json()
    const { name, colorway, angle, image } = body

    // Find existing render
    const existing = await prisma.productRender.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Product render not found' }, { status: 404 })
    }

    const updateData: any = {}

    if (name !== undefined) {
      updateData.name = name
    }

    if (colorway !== undefined) {
      updateData.colorway = colorway || null
    }

    if (angle !== undefined) {
      updateData.angle = angle || null
    }

    // If new image provided, upload it
    if (image && image.startsWith('data:')) {
      // Delete old image from storage if it exists
      if (existing.storagePath) {
        try {
          await deleteFromStorage(PRODUCT_RENDERS_BUCKET, existing.storagePath)
        } catch (e) {
          console.warn('[admin/product-renders] Failed to delete old image:', e)
        }
      }

      // Upload new image
      const safeName = (name || existing.name).toLowerCase().replace(/[^a-z0-9]/g, '-')
      const safeColorway = (colorway || existing.colorway || 'default').toLowerCase().replace(/[^a-z0-9]/g, '-')
      const timestamp = Date.now()
      const extension = image.includes('png') ? 'png' : 'jpg'
      
      const storagePath = `products/${safeName}/${safeColorway}-${timestamp}.${extension}`
      
      const imageUrl = await uploadBase64ToStorage(image, PRODUCT_RENDERS_BUCKET, storagePath)
      
      updateData.imageUrl = imageUrl
      updateData.storagePath = storagePath
    }

    const updated = await prisma.productRender.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('[admin/product-renders] Update error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update product render' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/product-renders/[id]
 * 
 * Delete a product render (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params

    // Find existing render
    const existing = await prisma.productRender.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Product render not found' }, { status: 404 })
    }

    // Delete from storage if local
    if (existing.storagePath && existing.source === 'local') {
      try {
        await deleteFromStorage(PRODUCT_RENDERS_BUCKET, existing.storagePath)
      } catch (e) {
        console.warn('[admin/product-renders] Failed to delete image from storage:', e)
      }
    }

    // Delete from database
    await prisma.productRender.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[admin/product-renders] Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete product render' },
      { status: 500 }
    )
  }
}

