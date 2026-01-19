import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public routes that don't require authentication checks
const PUBLIC_ROUTES = ['/login', '/signup', '/auth']

// Routes that skip middleware entirely (no auth call needed)
const SKIP_AUTH_ROUTES = ['/api']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(route => pathname.startsWith(route))
}

function shouldSkipAuth(pathname: string): boolean {
  return SKIP_AUTH_ROUTES.some(route => pathname.startsWith(route))
}

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
      return NextResponse.redirect(new URL('/projects', req.url))
    }
    // Allow access to public routes without further checks
    return res
  }

  // For protected routes, use getUser() for reliable server-validated auth
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|fonts).*)'],
}

