import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { safeNext } from '@/lib/auth/next-param'
import { isPublicRoute, shouldSkipAuth } from '@/lib/auth/route-rules'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const pathname = req.nextUrl.pathname

  // Skip auth check entirely for API routes - no Supabase call needed
  if (shouldSkipAuth(pathname)) {
    return res
  }

  // For public routes (login, signup, auth), we only need to check auth
  // if we want to redirect already-logged-in users away
  // Use getSession() here as it's cached and faster - we just need a quick check
  const supabase = createMiddlewareClient({ req, res })
  
  if (isPublicRoute(pathname)) {
    // Only check session to redirect logged-in users away from login/signup
    // getSession() is faster as it uses cached data
    const { data: { session } } = await supabase.auth.getSession()
    
    if (session && (pathname.startsWith('/login') || pathname.startsWith('/signup'))) {
      // Signed in already: go where the sign-in was taking them (the Claude
      // consent page, say), else the projects.
      return NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get('next')), req.url))
    }
    // Allow access to public routes without further checks
    return res
  }

  // For protected routes, use getUser() for reliable server-validated auth
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login, remembering where they were going
  if (!user) {
    const login = new URL('/login', req.url)
    const next = safeNext(`${pathname}${req.nextUrl.search}`, '')
    if (next && next !== '/') login.searchParams.set('next', next)
    return NextResponse.redirect(login)
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|fonts).*)'],
}

