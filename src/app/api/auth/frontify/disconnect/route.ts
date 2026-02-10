import { NextResponse } from 'next/server'
import {
  FRONTIFY_ACCESS_COOKIE,
  FRONTIFY_EXPIRES_COOKIE,
  FRONTIFY_REFRESH_COOKIE,
  FRONTIFY_RETURN_TO_COOKIE,
  FRONTIFY_STATE_COOKIE,
} from '@/lib/frontify/oauth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ disconnected: true })
  response.cookies.delete(FRONTIFY_ACCESS_COOKIE)
  response.cookies.delete(FRONTIFY_REFRESH_COOKIE)
  response.cookies.delete(FRONTIFY_EXPIRES_COOKIE)
  response.cookies.delete(FRONTIFY_STATE_COOKIE)
  response.cookies.delete(FRONTIFY_RETURN_TO_COOKIE)
  return response
}

