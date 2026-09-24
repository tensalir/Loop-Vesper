import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { NEXT_COOKIE, safeNext } from '@/lib/auth/next-param'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')
  const cookieStore = cookies()

  if (code) {
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (error) {
      console.error('[auth/callback] Error exchanging code for session:', error.message)
      // Redirect to login with error
      return NextResponse.redirect(new URL('/login?error=auth_callback_failed', requestUrl.origin))
    }

    // If this is a password recovery flow, redirect to the reset password page
    if (type === 'recovery') {
      return NextResponse.redirect(new URL('/reset-password', requestUrl.origin))
    }
  }

  // Where to go after signing in: the page the login started from (set by the
  // login page before a Google sign-in, e.g. the Claude consent page), else the projects.
  const saved = cookieStore.get(NEXT_COOKIE)?.value
  let target = '/projects'
  if (saved) {
    try {
      target = safeNext(decodeURIComponent(saved))
    } catch {
      target = '/projects'
    }
  }
  const response = NextResponse.redirect(new URL(target, requestUrl.origin))
  if (saved) response.cookies.set(NEXT_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}

