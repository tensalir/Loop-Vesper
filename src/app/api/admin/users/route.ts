import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 15

export async function GET(request: NextRequest) {
  try {
    const result = await requireAdmin()
    if (result.response) return result.response

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const status = searchParams.get('status') || 'all'
    const search = searchParams.get('search')?.trim() || ''

    const where: Prisma.ProfileWhereInput = {}

    if (status === 'active') {
      where.pausedAt = null
      where.deletedAt = null
    } else if (status === 'paused') {
      where.pausedAt = { not: null }
      where.deletedAt = null
    } else if (status === 'deleted') {
      where.deletedAt = { not: null }
    }
    // 'all' — include deleted users, no status filter

    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, users] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          pausedAt: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              generations: true,
              projects: true,
            },
          },
          generations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ])

    const mapped = users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      role: u.role,
      pausedAt: u.pausedAt,
      deletedAt: u.deletedAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      generationCount: u._count.generations,
      projectCount: u._count.projects,
      lastActiveAt: u.generations[0]?.createdAt ?? null,
    }))

    return NextResponse.json({
      users: mapped,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch users'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
