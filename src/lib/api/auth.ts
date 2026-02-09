import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { User } from '@supabase/supabase-js'

/**
 * Authenticate a request and return the user.
 * Uses getUser() for server-validated auth (not getSession() which reads from cookies).
 */
export async function getAuthUser(): Promise<{ user: User | null; error: string | null }> {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return { user: null, error: error?.message || 'Unauthorized' }
    }
    return { user, error: null }
  } catch (err: any) {
    return { user: null, error: err?.message || 'Auth check failed' }
  }
}

/**
 * Require admin role for a request.
 * Returns the user if they are an admin, or an error response.
 */
export async function requireAdmin(): Promise<
  | { user: User; response: null }
  | { user: null; response: NextResponse }
> {
  const { user, error } = await getAuthUser()
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 }),
    }
  }

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { role: true },
  })

  if (!profile || profile.role !== 'admin') {
    return {
      user: null,
      response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    }
  }

  return { user, response: null }
}

/**
 * Higher-order function that wraps an API route handler with auth.
 * Automatically returns 401 if user is not authenticated.
 * 
 * Usage:
 * ```ts
 * export const GET = withAuth(async (user, request) => {
 *   return NextResponse.json({ userId: user.id })
 * })
 * ```
 */
export function withAuth(
  handler: (user: User, request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const { user, error } = await getAuthUser()
    if (!user) {
      return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
    }
    return handler(user, request)
  }
}

/**
 * Higher-order function that wraps an API route handler with admin auth.
 * Automatically returns 401/403 if user is not an admin.
 */
export function withAdmin(
  handler: (user: User, request: NextRequest) => Promise<NextResponse>
) {
  return async (request: NextRequest) => {
    const result = await requireAdmin()
    if (result.response) return result.response
    return handler(result.user, request)
  }
}
