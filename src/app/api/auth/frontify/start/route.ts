import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import {
  FRONTIFY_RETURN_TO_COOKIE,
  FRONTIFY_STATE_COOKIE,
  createOAuthState,
  getFrontifyAuthorizeUrl,
  getFrontifyRedirectUri,
  getFrontifyScopes,
} from '@/lib/frontify/oauth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const requestedReturnTo = url.searchParams.get('returnTo') || '/projects'
  const returnTo = requestedReturnTo.startsWith('/') ? requestedReturnTo : '/projects'
  const state = createOAuthState()
  const redirectUri = getFrontifyRedirectUri(origin)

  const authUrl = new URL(getFrontifyAuthorizeUrl())
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', process.env.FRONTIFY_CLIENT_ID ?? '')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', getFrontifyScopes())
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl.toString())
  const isSecure = process.env.NODE_ENV === 'production'
  response.cookies.set(FRONTIFY_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60, // 10 minutes
  })
  response.cookies.set(FRONTIFY_RETURN_TO_COOKIE, returnTo, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  })
  return response
}

