import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

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

    const { id } = params
    const body = await request.json()
    const { name, isPrivate } = body

    // First verify the session belongs to the user via the project
    const existingSession = await prisma.sessions.findUnique({
      where: { id },
      include: { project: true },
    })

    if (!existingSession || existingSession.project.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Update session
    const updatedSession = await prisma.sessions.update({
      where: { id },
      data: {
        ...(name && typeof name === 'string' && { name: name.trim() }),
        ...(typeof isPrivate === 'boolean' && { isPrivate }),
        updatedAt: new Date(),
      },
    })

    return NextResponse.json(updatedSession)
  } catch (error) {
    console.error('Error updating session:', error)
    return NextResponse.json(
      { error: 'Failed to update session' },
      { status: 500 }
    )
  }
}

// DELETE /api/sessions/[id] - Delete a session and all its generations/outputs
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

    const { id } = params

    // Verify the session belongs to the user via the project
    const existingSession = await prisma.sessions.findUnique({
      where: { id },
      include: { project: true },
    })

    if (!existingSession || existingSession.project.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: 'Session not found or unauthorized' },
        { status: 404 }
      )
    }

    // Delete the session (cascade will delete generations and outputs)
    await prisma.sessions.delete({
      where: { id },
    })

    return NextResponse.json({
      message: 'Session and all its contents deleted successfully',
      sessionId: id,
    })
  } catch (error) {
    console.error('Error deleting session:', error)
    return NextResponse.json(
      { error: 'Failed to delete session' },
      { status: 500 }
    )
  }
}

