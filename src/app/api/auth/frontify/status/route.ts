import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  FRONTIFY_ACCESS_COOKIE,
  FRONTIFY_EXPIRES_COOKIE,
  FRONTIFY_REFRESH_COOKIE,
} from '@/lib/frontify/oauth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = cookies()
  const accessToken = cookieStore.get(FRONTIFY_ACCESS_COOKIE)?.value
  const refreshToken = cookieStore.get(FRONTIFY_REFRESH_COOKIE)?.value
  const expiresAtRaw = cookieStore.get(FRONTIFY_EXPIRES_COOKIE)?.value
  const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : null

  return NextResponse.json({
    connected: !!accessToken,
    hasRefreshToken: !!refreshToken,
    expiresAt,
    expired: expiresAt != null ? Date.now() >= expiresAt : null,
    usingEnvTokenFallback: !!process.env.FRONTIFY_API_TOKEN,
  })
}

