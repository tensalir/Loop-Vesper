'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Plus } from 'lucide-react'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { useProjectsInfinite } from '@/hooks/useProjects'
import { useProfile } from '@/hooks/useProfile'
import { useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'

export default function ProjectsPage() {
  const [showNewProject, setShowNewProject] = useState(false)
  const [projectScope, setProjectScope] = useState<'all' | 'mine'>('all')
  const queryClient = useQueryClient()
  
  const { data: profile } = useProfile()
  const {
    projects,
    isLoading: loading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useProjectsInfinite(20, projectScope)

  const visibleProjects = projects
  const visibleCountLabel = projectScope === 'mine'
    ? `${visibleProjects.length} ${visibleProjects.length === 1 ? 'project' : 'projects'} you own`
    : `${visibleProjects.length} ${visibleProjects.length === 1 ? 'project' : 'projects'} available`

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
            {visibleCountLabel}
          </p>
        </div>
        <Button onClick={() => setShowNewProject(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Tabs
          value={projectScope}
          onValueChange={(value) => setProjectScope(value as 'all' | 'mine')}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full grid-cols-2 sm:w-[320px]">
            <TabsTrigger value="all">
              All Projects
            </TabsTrigger>
            <TabsTrigger value="mine">
              My Projects
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          Showing {visibleProjects.length} loaded
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-muted-foreground">Loading projects...</p>
          </div>
        </div>
      ) : visibleProjects.length === 0 && projectScope === 'all' ? (
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
      ) : visibleProjects.length === 0 && projectScope === 'mine' ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
          <h2 className="text-2xl font-semibold">No projects yet in My Projects</h2>
          <p className="text-muted-foreground max-w-md">
            Switch to All Projects to browse shared work, or create a new project to start your own.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setProjectScope('all')}>
              View All Projects
            </Button>
            <Button onClick={() => setShowNewProject(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
        <ProjectGrid
          projects={visibleProjects}
          currentUserId={profile?.id}
          onProjectUpdate={handleProjectUpdate}
        />
          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="min-w-40"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load More'
                )}
              </Button>
            </div>
          )}
        </div>
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

