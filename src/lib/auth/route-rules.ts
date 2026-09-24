/**
 * Which paths the middleware leaves alone. Kept out of `src/middleware.ts` so
 * the rules can be tested without loading the middleware.
 */

// Public routes that don't require authentication checks.
// Includes password recovery pages so unauthenticated users can reset their password.
export const PUBLIC_ROUTES = ['/login', '/signup', '/auth', '/forgot-password', '/reset-password']

// Routes that skip middleware entirely (no auth call needed). `/.well-known`
// holds the OAuth discovery documents, which MCP clients read before signing in.
export const SKIP_AUTH_ROUTES = ['/api', '/.well-known']

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route))
}

export function shouldSkipAuth(pathname: string): boolean {
  return SKIP_AUTH_ROUTES.some((route) => pathname.startsWith(route))
}
