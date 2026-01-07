'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useProjects } from '@/hooks/useProjects'
import { useApprovedOutputs } from '@/hooks/useApprovedOutputs'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import {
  Plus,
  FolderKanban,
  CheckCircle,
  Bookmark,
  ArrowRight,
  Sparkles,
} from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showNewProject, setShowNewProject] = useState(false)
  
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { data: approvedOutputs = [] } = useApprovedOutputs()
  
  // Get the 4 most recent projects
  const recentProjects = projects.slice(0, 4)
  const hasProjects = projects.length > 0

  const handleProjectCreated = (project: Project) => {
    queryClient.setQueryData(['projects'], (oldData: (Project & { thumbnailUrl?: string | null })[] | undefined) => {
      if (!oldData) return [project]
      return [{ ...project, thumbnailUrl: null }, ...oldData]
    })
    setShowNewProject(false)
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    router.push(`/projects/${project.id}`)
  }

  const handleProjectUpdate = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome Section */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back. Here&apos;s an overview of your creative workspace.
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* New Project */}
        <Card 
          className="group cursor-pointer border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 transition-all duration-200"
          onClick={() => setShowNewProject(true)}
        >
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <p className="font-semibold">New Project</p>
            <p className="text-xs text-muted-foreground mt-1">Start creating</p>
          </CardContent>
        </Card>

        {/* Continue Latest */}
        <Card 
          className={`group cursor-pointer hover:border-primary/50 hover:shadow-md transition-all duration-200 ${!hasProjects ? 'opacity-50 pointer-events-none' : ''}`}
          onClick={() => hasProjects && router.push(`/projects/${projects[0].id}`)}
        >
          <CardContent className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center mb-3 group-hover:bg-accent/20 transition-colors">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <p className="font-semibold">Continue</p>
            <p className="text-xs text-muted-foreground mt-1 truncate max-w-full px-2">
              {hasProjects ? projects[0].name : 'No projects yet'}
            </p>
          </CardContent>
        </Card>

        {/* Review Items */}
        <Link href="/review">
          <Card className="group cursor-pointer hover:border-primary/50 hover:shadow-md transition-all duration-200 h-full">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-3 group-hover:bg-green-500/20 transition-colors">
                <CheckCircle className="h-6 w-6 text-green-500" />
              </div>
              <p className="font-semibold">Review</p>
              <p className="text-xs text-muted-foreground mt-1">
                {approvedOutputs.length} approved {approvedOutputs.length === 1 ? 'item' : 'items'}
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Bookmarks */}
        <Link href="/bookmarks">
          <Card className="group cursor-pointer hover:border-primary/50 hover:shadow-md transition-all duration-200 h-full">
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-3 group-hover:bg-amber-500/20 transition-colors">
                <Bookmark className="h-6 w-6 text-amber-500" />
              </div>
              <p className="font-semibold">Bookmarks</p>
              <p className="text-xs text-muted-foreground mt-1">Your favorites</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Projects Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Recent Projects</h2>
            <p className="text-sm text-muted-foreground">
              {hasProjects
                ? 'Pick up where you left off'
                : 'Create your first project to get started'}
            </p>
          </div>
          {hasProjects && (
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="gap-1">
                View all
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>

        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-0">
                  <div className="aspect-video bg-muted" />
                </CardContent>
                <div className="p-4 space-y-2">
                  <div className="h-5 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        ) : hasProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {recentProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onProjectUpdate={handleProjectUpdate}
              />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <FolderKanban className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Create your first project to start generating AI images and videos
              </p>
              <Button onClick={() => setShowNewProject(true)} size="lg">
                <Plus className="mr-2 h-5 w-5" />
                Create Your First Project
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stats Section (Optional - using real data) */}
      {hasProjects && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Projects</CardDescription>
              <CardTitle className="text-3xl">{projects.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Approved Items</CardDescription>
              <CardTitle className="text-3xl">{approvedOutputs.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ready for Review</CardDescription>
              <CardTitle className="text-3xl text-primary">
                {approvedOutputs.length > 0 ? 'Yes' : 'No'}
              </CardTitle>
            </CardHeader>
          </Card>
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

