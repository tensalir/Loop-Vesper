import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    logMetric({
      name: 'api_health_get',
      status: 'success',
      durationMs: Date.now() - startedAt,
      meta: { db: 'ok' },
    })
    return NextResponse.json({
      status: 'ok',
      services: {
        database: 'ok',
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    logMetric({
      name: 'api_health_get',
      status: 'error',
      durationMs: Date.now() - startedAt,
      meta: { db: 'error', error: error?.message },
    })
    return NextResponse.json(
      {
        status: 'error',
        services: {
          database: 'error',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

