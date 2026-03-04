import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { response } = await requireAdmin()
  if (response) return response

  const projectId = params.id

  const existing = await prisma.brandWorldProjectSettings.findUnique({
    where: { projectId },
  })

  if (!existing) {
    return NextResponse.json({ ok: true, message: 'Already unlinked' })
  }

  await prisma.brandWorldProjectSettings.delete({
    where: { projectId },
  })

  return NextResponse.json({ ok: true })
}
