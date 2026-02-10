import { NextRequest, NextResponse } from 'next/server'
import {
  FRONTIFY_ACCESS_COOKIE,
  FRONTIFY_EXPIRES_COOKIE,
  FRONTIFY_REFRESH_COOKIE,
  FRONTIFY_RETURN_TO_COOKIE,
  FRONTIFY_STATE_COOKIE,
  getFrontifyRedirectUri,
  getFrontifyTokenUrl,
} from '@/lib/frontify/oauth'

export const dynamic = 'force-dynamic'

interface FrontifyTokenResponse {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const savedState = request.cookies.get(FRONTIFY_STATE_COOKIE)?.value
  const rawReturnTo = request.cookies.get(FRONTIFY_RETURN_TO_COOKIE)?.value || '/projects'
  const returnTo = rawReturnTo.startsWith('/') ? rawReturnTo : '/projects'

  if (!code) {
    return NextResponse.redirect(new URL('/projects?frontify=missing_code', origin))
  }
  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL('/projects?frontify=invalid_state', origin))
  }

  const clientId = process.env.FRONTIFY_CLIENT_ID
  const clientSecret = process.env.FRONTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/projects?frontify=missing_client_credentials', origin))
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getFrontifyRedirectUri(origin),
  })

  const tokenRes = await fetch(getFrontifyTokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenBody.toString(),
  })

  let tokenJson: FrontifyTokenResponse = {}
  try {
    tokenJson = (await tokenRes.json()) as FrontifyTokenResponse
  } catch {
    tokenJson = {}
  }

  if (!tokenRes.ok || !tokenJson.access_token) {
    const errorCode = tokenJson.error || `http_${tokenRes.status}`
    return NextResponse.redirect(new URL(`/projects?frontify=token_exchange_failed&reason=${encodeURIComponent(errorCode)}`, origin))
  }

  const response = NextResponse.redirect(new URL(returnTo, origin))
  const isSecure = process.env.NODE_ENV === 'production'
  const expiresAt =
    typeof tokenJson.expires_in === 'number'
      ? Date.now() + tokenJson.expires_in * 1000
      : Date.now() + 3600 * 1000

  response.cookies.set(FRONTIFY_ACCESS_COOKIE, tokenJson.access_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600,
  })
  if (tokenJson.refresh_token) {
    response.cookies.set(FRONTIFY_REFRESH_COOKIE, tokenJson.refresh_token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
    })
  }
  response.cookies.set(FRONTIFY_EXPIRES_COOKIE, String(expiresAt), {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600,
  })

  // one-time flow cookies
  response.cookies.delete(FRONTIFY_STATE_COOKIE)
  response.cookies.delete(FRONTIFY_RETURN_TO_COOKIE)

  return response
}

