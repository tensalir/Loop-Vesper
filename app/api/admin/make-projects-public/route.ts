import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// POST /api/admin/make-projects-public - One-time migration to make all projects visible in community feed
export async function POST(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Update all projects to be shared (visible in community feed)
    const result = await prisma.project.updateMany({
      where: {
        isShared: false,
      },
      data: {
        isShared: true,
      },
    })

    return NextResponse.json({
      message: `Updated ${result.count} projects to be visible in community feed`,
      count: result.count,
    })
  } catch (error) {
    console.error('Error updating projects:', error)
    return NextResponse.json(
      { error: 'Failed to update projects' },
      { status: 500 }
    )
  }
}
