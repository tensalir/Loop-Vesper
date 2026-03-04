'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useProjects } from '@/hooks/useProjects'
import { useProfile } from '@/hooks/useProfile'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, ShieldAlert } from 'lucide-react'

const BrandWorldViewport = dynamic(
  () => import('@/components/brand-world/BrandWorldViewport').then((m) => m.BrandWorldViewport),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-muted/20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading Brand World&hellip;</p>
        </div>
      </div>
    ),
  }
)

export default function BrandWorldPage() {
  const router = useRouter()
  const { data: profile, isLoading: profileLoading } = useProfile()
  const isAdmin = profile?.role === 'admin'
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const selectedProject = projects?.find((p) => p.id === selectedProjectId) ?? null

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-4">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-1">Admin access required</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Brand World is currently available to admin users only.
          </p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-primary hover:underline"
        >
          Back to dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 md:-m-6 lg:-m-8">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/30 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Brand World</h1>
            <p className="text-xs text-muted-foreground">
              Interactive festival world for AI-generated content
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={selectedProjectId ?? ''}
            onValueChange={(val) => setSelectedProjectId(val || null)}
          >
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder={projectsLoading ? 'Loading projects\u2026' : 'Select a project'} />
            </SelectTrigger>
            <SelectContent>
              {projects?.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 3D Viewport */}
      <div className="flex-1 relative overflow-hidden">
        <BrandWorldViewport
          projectId={selectedProjectId}
          projectName={selectedProject?.name ?? null}
        />
      </div>
    </div>
  )
}
