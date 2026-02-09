import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

export async function PUT(
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

    const generationId = params.id

    if (!generationId) {
      return NextResponse.json(
        { error: 'Generation ID is required' },
        { status: 400 }
      )
    }

    // Fetch the generation
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
    })

    if (!generation) {
      return NextResponse.json(
        { error: 'Generation not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (generation.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Only cancel if still processing
    if (generation.status !== 'processing') {
      return NextResponse.json(
        { error: `Generation is already ${generation.status}` },
        { status: 400 }
      )
    }

    // Update generation status to cancelled
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: 'cancelled',
        parameters: {
          ...(generation.parameters as any),
          cancelledAt: new Date().toISOString(),
          cancelledReason: 'User cancelled',
        },
      },
    })

    return NextResponse.json({
      id: generationId,
      status: 'cancelled',
      message: 'Generation cancelled successfully',
    })
  } catch (error: any) {
    console.error('Error cancelling generation:', error)
    return NextResponse.json(
      { error: 'Failed to cancel generation', details: error.message },
      { status: 500 }
    )
  }
}

