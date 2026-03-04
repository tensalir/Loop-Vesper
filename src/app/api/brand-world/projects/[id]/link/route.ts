import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { user, response } = await requireAdmin()
  if (response) return response

  const projectId = params.id

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  let source = 'linked'
  try {
    const body = await request.json()
    if (body?.source === 'created') source = 'created'
  } catch {
    // no body — default to 'linked'
  }

  const settings = await prisma.brandWorldProjectSettings.upsert({
    where: { projectId },
    update: {},
    create: {
      projectId,
      linkedByUserId: user.id,
      source,
    },
  })

  return NextResponse.json(settings)
}
