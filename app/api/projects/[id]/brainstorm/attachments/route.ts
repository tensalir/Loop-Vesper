import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Check if user has access to the project (owner or invited member)
 */
async function checkProjectAccess(projectId: string, userId: string) {
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
      ],
    },
    select: { id: true },
  })
  return !!project
}

/**
 * POST /api/projects/[id]/brainstorm/attachments
 * Upload files to Supabase Storage for chat attachments
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id

    // Check project access
    const hasAccess = await checkProjectAccess(projectId, user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Parse form data
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const uploadedFiles: { 
      name: string
      url: string
      type: string
      size: number
      storagePath: string
    }[] = []

    for (const file of files) {
      // Generate unique filename
      const timestamp = Date.now()
      const randomSuffix = Math.random().toString(36).substring(2, 8)
      const extension = file.name.split('.').pop() || ''
      const fileName = `${timestamp}-${randomSuffix}.${extension}`
      
      // Storage path: chat-attachments/{userId}/{projectId}/{fileName}
      const storagePath = `chat-attachments/${user.id}/${projectId}/${fileName}`

      // Convert file to buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('generated-images') // Using existing bucket
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        })

      if (error) {
        console.error('Storage upload error:', error)
        continue // Skip failed uploads
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('generated-images')
        .getPublicUrl(storagePath)

      uploadedFiles.push({
        name: file.name,
        url: publicUrl,
        type: file.type,
        size: file.size,
        storagePath,
      })
    }

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: 'Failed to upload files' },
        { status: 500 }
      )
    }

    return NextResponse.json({ files: uploadedFiles })
  } catch (error: any) {
    console.error('Error uploading attachments:', error)
    return NextResponse.json(
      { error: 'Failed to upload attachments' },
      { status: 500 }
    )
  }
}

