import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Use service role for storage operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'generated-images'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB max

/**
 * Upload reference image to Supabase Storage
 * 
 * This endpoint accepts multipart form data (File upload) instead of base64,
 * which allows larger files without hitting Vercel's 4.5MB body limit.
 * 
 * The browser can stream the file directly, and Vercel handles chunked uploads.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session }, error: authError } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const purpose = formData.get('purpose') as string || 'reference' // 'reference' | 'endframe'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      }, { status: 400 })
    }

    // Generate unique path
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).slice(2, 8)
    const extension = file.type.includes('png') ? 'png' : 'jpg'
    const storagePath = `references/${userId}/${purpose}-${timestamp}-${randomId}.${extension}`

    // Convert File to ArrayBuffer then to Buffer for upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ 
        error: `Upload failed: ${uploadError.message}` 
      }, { status: 500 })
    }

    // Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    return NextResponse.json({
      url: publicUrlData.publicUrl,
      path: storagePath,
      bucket: BUCKET,
      size: file.size,
      mimeType: file.type,
    })

  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json({ 
      error: error.message || 'Upload failed' 
    }, { status: 500 })
  }
}
