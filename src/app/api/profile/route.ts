import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create profile
    let profile = await prisma.profile.findUnique({
      where: { id: user.id },
    })

    if (!profile) {
      // Create profile if it doesn't exist (default role: user)
      profile = await prisma.profile.create({
        data: {
          id: user.id,
          username: user.email?.split('@')[0] || null,
          displayName: user.user_metadata?.full_name || null,
          avatarUrl: user.user_metadata?.avatar_url || null,
          role: UserRole.user, // Default role for new users
        },
      })
    }

    return NextResponse.json(profile)
  } catch (error) {
    console.error('Error fetching profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { displayName, username, avatarUrl } = body

    // Update profile (note: role cannot be changed via this endpoint for security)
    const profile = await prisma.profile.upsert({
      where: { id: user.id },
      update: {
        displayName: displayName?.trim() || null,
        username: username?.trim() || null,
        avatarUrl: avatarUrl || null,
        updatedAt: new Date(),
      },
      create: {
        id: user.id,
        displayName: displayName?.trim() || null,
        username: username?.trim() || null,
        avatarUrl: avatarUrl || null,
        role: UserRole.user, // Default role for new users
      },
    })

    return NextResponse.json(profile)
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    )
  }
}

