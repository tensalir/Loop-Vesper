'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { useProjects } from '@/hooks/useProjects'
import { useProfile } from '@/hooks/useProfile'
import { useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'

export default function ProjectsPage() {
  const [showNewProject, setShowNewProject] = useState(false)
  const queryClient = useQueryClient()
  
  const { data: profile } = useProfile()
  const { data: projects = [], isLoading: loading } = useProjects()

  const handleProjectCreated = (project: Project) => {
    queryClient.setQueryData(['projects'], (oldData: (Project & { thumbnailUrl?: string | null })[] | undefined) => {
      if (!oldData) return [project]
      return [{ ...project, thumbnailUrl: null }, ...oldData]
    })
    setShowNewProject(false)
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  const handleProjectUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'} total
          </p>
        </div>
        <Button onClick={() => setShowNewProject(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first project to start generating AI content
            </p>
            <Button onClick={() => setShowNewProject(true)} size="lg">
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Project
            </Button>
          </div>
        </div>
      ) : (
        <ProjectGrid
          projects={projects}
          currentUserId={profile?.id}
          onProjectUpdate={handleProjectUpdate}
        />
      )}

      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  )
}

