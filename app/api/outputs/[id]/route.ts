import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// PATCH /api/outputs/[id] - Update an output (e.g., star/unstar)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { isStarred, isApproved } = body

    // Verify the output belongs to the user
    const output = await prisma.outputs.findUnique({
      where: { id: params.id },
      include: {
        generation: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!output) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    if (output.generation.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Update the output
    const updatedOutput = await prisma.outputs.update({
      where: { id: params.id },
      data: {
        ...(typeof isStarred === 'boolean' && { isStarred }),
        ...(typeof isApproved === 'boolean' && { isApproved }),
      },
    })

    return NextResponse.json(updatedOutput)
  } catch (error) {
    console.error('Error updating output:', error)
    return NextResponse.json(
      { error: 'Failed to update output' },
      { status: 500 }
    )
  }
}

// DELETE /api/outputs/[id] - Delete an output
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the output belongs to the user
    const output = await prisma.outputs.findUnique({
      where: { id: params.id },
      include: {
        generation: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!output) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    if (output.generation.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    await prisma.outputs.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting output:', error)
    return NextResponse.json(
      { error: 'Failed to delete output' },
      { status: 500 }
    )
  }
}

