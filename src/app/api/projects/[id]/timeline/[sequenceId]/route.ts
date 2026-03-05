import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const TIMELINE_MAX_DURATION_MS = 120_000

async function verifySequenceAccess(sequenceId: string, userId: string) {
  return prisma.timelineSequence.findFirst({
    where: {
      id: sequenceId,
      project: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
          { isShared: true },
        ],
      },
    },
    select: { id: true, projectId: true, userId: true },
  })
}

/**
 * GET /api/projects/:id/timeline/:sequenceId - Full sequence with all tracks/clips/captions/transitions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sequenceId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sequence = await prisma.timelineSequence.findFirst({
      where: { id: params.sequenceId, projectId: params.id },
      include: {
        tracks: {
          include: {
            clips: { orderBy: { startMs: 'asc' } },
            captions: { orderBy: { startMs: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        transitions: true,
      },
    })

    if (!sequence) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })

    return NextResponse.json({ sequence })
  } catch (error) {
    console.error('GET sequence error:', error)
    return NextResponse.json({ error: 'Failed to load sequence' }, { status: 500 })
  }
}

/**
 * PATCH /api/projects/:id/timeline/:sequenceId - Update sequence (full state save)
 *
 * Accepts a JSON body with the full tracks/clips/captions/transitions state.
 * Uses a transaction to replace all child records atomically.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; sequenceId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await verifySequenceAccess(params.sequenceId, user.id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const { name, durationMs, tracks, transitions } = body

    if (typeof durationMs === 'number' && durationMs > TIMELINE_MAX_DURATION_MS) {
      return NextResponse.json(
        { error: `Duration exceeds maximum of ${TIMELINE_MAX_DURATION_MS}ms (${TIMELINE_MAX_DURATION_MS / 1000}s)` },
        { status: 400 }
      )
    }

    // Validate clip ranges
    if (Array.isArray(tracks)) {
      for (const track of tracks) {
        for (const clip of track.clips ?? []) {
          if (typeof clip.startMs !== 'number' || typeof clip.endMs !== 'number') continue
          if (clip.startMs < 0 || clip.endMs <= clip.startMs) {
            return NextResponse.json(
              { error: `Invalid clip range: startMs=${clip.startMs}, endMs=${clip.endMs}` },
              { status: 400 }
            )
          }
        }
      }
    }

    // Validate transition integrity: from/to clips must exist and share a track
    if (Array.isArray(transitions) && transitions.length > 0 && Array.isArray(tracks)) {
      const clipToTrack = new Map<string, string>()
      for (const track of tracks) {
        for (const clip of track.clips ?? []) {
          clipToTrack.set(clip.id, track.id)
        }
      }
      for (const t of transitions) {
        const fromTrack = clipToTrack.get(t.fromClipId)
        const toTrack = clipToTrack.get(t.toClipId)
        if (!fromTrack || !toTrack) {
          return NextResponse.json(
            { error: `Transition references missing clip: from=${t.fromClipId}, to=${t.toClipId}` },
            { status: 400 }
          )
        }
        if (fromTrack !== toTrack) {
          return NextResponse.json(
            { error: 'Transitions must connect clips on the same track' },
            { status: 400 }
          )
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Update sequence metadata
      const seq = await tx.timelineSequence.update({
        where: { id: params.sequenceId },
        data: {
          ...(name !== undefined && { name }),
          ...(typeof durationMs === 'number' && { durationMs }),
        },
      })

      // Replace tracks + clips + captions if provided
      if (Array.isArray(tracks)) {
        await tx.timelineTrack.deleteMany({ where: { sequenceId: params.sequenceId } })

        for (const track of tracks) {
          const createdTrack = await tx.timelineTrack.create({
            data: {
              id: track.id,
              sequenceId: params.sequenceId,
              kind: track.kind,
              label: track.label || 'Track',
              sortOrder: track.sortOrder ?? 0,
              isMuted: track.isMuted ?? false,
            },
          })

          if (Array.isArray(track.clips)) {
            await tx.timelineClip.createMany({
              data: track.clips.map((clip: any) => ({
                id: clip.id,
                trackId: createdTrack.id,
                outputId: clip.outputId || null,
                fileUrl: clip.fileUrl,
                fileType: clip.fileType,
                startMs: clip.startMs,
                endMs: clip.endMs,
                inPointMs: clip.inPointMs ?? 0,
                outPointMs: clip.outPointMs,
                sourceDurationMs: clip.sourceDurationMs,
                sortOrder: clip.sortOrder ?? 0,
              })),
            })
          }

          if (Array.isArray(track.captions)) {
            await tx.timelineCaption.createMany({
              data: track.captions.map((cap: any) => ({
                id: cap.id,
                trackId: createdTrack.id,
                text: cap.text,
                startMs: cap.startMs,
                endMs: cap.endMs,
                style: cap.style ?? {},
              })),
            })
          }
        }
      }

      // Replace transitions if provided
      if (Array.isArray(transitions)) {
        await tx.timelineTransition.deleteMany({ where: { sequenceId: params.sequenceId } })
        if (transitions.length > 0) {
          await tx.timelineTransition.createMany({
            data: transitions.map((t: any) => ({
              id: t.id,
              sequenceId: params.sequenceId,
              type: t.type || 'cross_dissolve',
              fromClipId: t.fromClipId,
              toClipId: t.toClipId,
              durationMs: t.durationMs ?? 500,
            })),
          })
        }
      }

      // Refetch full state
      return tx.timelineSequence.findUnique({
        where: { id: params.sequenceId },
        include: {
          tracks: {
            include: {
              clips: { orderBy: { startMs: 'asc' } },
              captions: { orderBy: { startMs: 'asc' } },
            },
            orderBy: { sortOrder: 'asc' },
          },
          transitions: true,
        },
      })
    })

    return NextResponse.json({ sequence: updated })
  } catch (error) {
    console.error('PATCH sequence error:', error)
    return NextResponse.json({ error: 'Failed to save timeline' }, { status: 500 })
  }
}

/**
 * DELETE /api/projects/:id/timeline/:sequenceId - Delete a sequence and all children
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sequenceId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await verifySequenceAccess(params.sequenceId, user.id)
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.timelineSequence.delete({ where: { id: params.sequenceId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE sequence error:', error)
    return NextResponse.json({ error: 'Failed to delete timeline' }, { status: 500 })
  }
}
