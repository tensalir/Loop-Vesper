import { NextRequest, NextResponse } from 'next/server'
import { withAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

export const GET = withAdmin(async (_user, request: NextRequest) => {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'linked'

  const where =
    mode === 'linked'
      ? { brandWorldSettings: { isNot: null } }
      : undefined

  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      owner: {
        select: { id: true, displayName: true, username: true },
      },
      sessions: {
        select: { id: true, name: true, type: true },
      },
      brandWorldSettings: {
        select: { source: true, createdAt: true },
      },
    },
  })

  return NextResponse.json(projects)
})
