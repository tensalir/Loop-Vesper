import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { prisma } from '@/lib/prisma'
import { BrandWorldDetailClient } from './BrandWorldDetailClient'

interface PageProps {
  params: { id: string }
}

export default async function BrandWorldDetailPage({ params }: PageProps) {
  const supabase = createServerComponentClient({ cookies })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/login')
  }

  const userId = session.user.id

  const [profile, project] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
    prisma.project.findFirst({
      where: {
        id: params.id,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
          { isShared: true },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        sessions: {
          select: { id: true, name: true, type: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ])

  if (profile?.role !== 'admin') {
    redirect('/')
  }

  if (!project) {
    redirect('/brand-world')
  }

  return (
    <BrandWorldDetailClient
      projectId={project.id}
      projectName={project.name}
      projectDescription={project.description}
      initialSessions={project.sessions}
    />
  )
}
