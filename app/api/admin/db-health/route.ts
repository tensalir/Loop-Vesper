import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'
  let statusCode = 200

  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      metricStatus = 'error'
      statusCode = 401
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SECURITY: Require admin role for admin endpoints
    const profile = await prisma.profile.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      metricStatus = 'error'
      statusCode = 403
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'ok',
      checkedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    metricStatus = 'error'
    statusCode = 500
    return NextResponse.json(
      {
        status: 'error',
        error: error?.message || 'Database health check failed',
        checkedAt: new Date().toISOString(),
      },
      { status: 500 }
    )
  } finally {
    logMetric({
      name: 'api_admin_db_health_get',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
      meta: { statusCode },
    })
  }
}

