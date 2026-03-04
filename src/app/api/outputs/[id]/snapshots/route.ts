import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BUCKET = 'generated-images'
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/**
 * POST /api/outputs/[id]/snapshots
 *
 * Capture a video frame as a first-class image Output.
 * The client extracts the frame via canvas and uploads as multipart form data.
 *
 * Body (multipart):
 *   - file: the JPEG/PNG frame blob
 *   - timecodeMs: playhead position in ms
 *   - sessionId: image session to attach the snapshot to
 *
 * Creates:
 *   - A completed Generation (modelId: 'snapshot-capture')
 *   - An Output (fileType: 'image') linked to the generation
 *
 * Returns the new Output so the client can use it immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = user.id
    const sourceVideoOutputId = params.id

    // Parse multipart form
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const timecodeMs = parseInt(formData.get('timecodeMs') as string || '0', 10)
    const sessionId = formData.get('sessionId') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 })
    }

    // Verify the source video output exists and user has access
    const sourceOutput = await prisma.output.findUnique({
      where: { id: sourceVideoOutputId },
      include: {
        generation: {
          include: {
            session: {
              include: {
                project: {
                  include: {
                    members: { where: { userId }, select: { userId: true } },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!sourceOutput) {
      return NextResponse.json({ error: 'Source output not found' }, { status: 404 })
    }

    const project = sourceOutput.generation.session.project
    const isOwner = project.ownerId === userId
    const isMember = project.members.length > 0

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Resolve target session — prefer explicit sessionId, fall back to source generation's session
    let targetSessionId = sessionId
    if (!targetSessionId) {
      // Find an image session in the same project, or use the source session
      const imageSession = await prisma.session.findFirst({
        where: { projectId: project.id, type: 'image' },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      targetSessionId = imageSession?.id ?? sourceOutput.generation.sessionId
    }

    // Trace lineage: walk up to the root image output via sourceOutputId chain
    const sourceParams = sourceOutput.generation.parameters as any
    const sourceRootOutputId = sourceParams?.sourceOutputId ?? sourceVideoOutputId

    // Upload frame to storage
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).slice(2, 8)
    const ext = file.type.includes('png') ? 'png' : 'jpg'
    const storagePath = `snapshots/${userId}/${timestamp}-${randomId}.${ext}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: true })

    if (uploadError) {
      console.error('Snapshot upload error:', uploadError)
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    const imageUrl = publicUrlData.publicUrl

    // Create generation + output in a transaction
    const generation = await prisma.generation.create({
      data: {
        sessionId: targetSessionId,
        userId,
        modelId: 'snapshot-capture',
        prompt: `Snapshot at ${(timecodeMs / 1000).toFixed(2)}s`,
        status: 'completed',
        parameters: {
          sourceKind: 'snapshot',
          sourceVideoOutputId,
          sourceRootOutputId,
          sourceTimecodeMs: timecodeMs,
          sourceLabel: `Snapshot @ ${(timecodeMs / 1000).toFixed(1)}s`,
        },
      },
    })

    const output = await prisma.output.create({
      data: {
        generationId: generation.id,
        fileUrl: imageUrl,
        fileType: 'image',
      },
    })

    // Touch the session so it sorts to top
    await prisma.session.update({
      where: { id: targetSessionId },
      data: { updatedAt: new Date() },
    }).catch(() => {})

    return NextResponse.json({
      generation: {
        id: generation.id,
        sessionId: targetSessionId,
        status: 'completed',
        parameters: generation.parameters,
      },
      output: {
        id: output.id,
        generationId: generation.id,
        fileUrl: imageUrl,
        fileType: 'image',
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('Snapshot error:', error)
    return NextResponse.json({ error: error.message || 'Failed to create snapshot' }, { status: 500 })
  }
}
