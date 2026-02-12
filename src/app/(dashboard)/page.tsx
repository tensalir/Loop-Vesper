'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useProjects } from '@/hooks/useProjects'
import { useCommunityCreations, type CommunityCreation } from '@/hooks/useCommunityCreations'
import { useProfile } from '@/hooks/useProfile'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { CommunityCreationDialog } from '@/components/generation/CommunityCreationDialog'
import { useQueryClient } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import {
  Plus,
  FolderKanban,
  ArrowRight,
  Sparkles,
  Play,
  User,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showNewProject, setShowNewProject] = useState(false)
  const [selectedCreation, setSelectedCreation] = useState<CommunityCreation | null>(null)
  const projectsScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  
  const { data: profile } = useProfile()
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { 
    data: communityCreations = [], 
    isLoading: communityLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useCommunityCreations(8)
  
  // Get recent projects for horizontal scroll (show more for scrolling)
  const recentProjects = projects.slice(0, 6)
  const hasProjects = projects.length > 0

  // Check scroll state for arrows
  const checkScrollState = useCallback(() => {
    const el = projectsScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10)
  }, [])

  const scrollProjects = useCallback((direction: 'left' | 'right') => {
    const el = projectsScrollRef.current
    if (!el) return
    const cardWidth = 320 // Approximate card width + gap
    const scrollAmount = direction === 'left' ? -cardWidth : cardWidth
    el.scrollBy({ left: scrollAmount, behavior: 'smooth' })
    // Check state after animation
    setTimeout(checkScrollState, 350)
  }, [checkScrollState])

  // Check scroll state when projects change
  useEffect(() => {
    // Small delay to ensure DOM is updated
    const timeout = setTimeout(checkScrollState, 100)
    return () => clearTimeout(timeout)
  }, [recentProjects.length, checkScrollState])

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

      {/* Quick Actions - Simplified horizontal layout */}
      <div className="flex flex-wrap gap-2">
        <Button 
          variant="default"
          className="gap-2"
          onClick={() => setShowNewProject(true)}
        >
          <Plus className="h-4 w-4" />
          New Project
        </Button>
        
        {hasProjects && (
          <Button 
            variant="secondary"
            className="gap-2"
            onClick={() => router.push(`/projects/${projects[0].id}`)}
          >
            <Sparkles className="h-4 w-4" />
            Continue: {projects[0].name.length > 20 ? projects[0].name.slice(0, 20) + '...' : projects[0].name}
          </Button>
        )}

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
          <div className="flex items-center gap-2">
            {/* Scroll arrows - only show when there are projects */}
            {hasProjects && recentProjects.length > 3 && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => scrollProjects('left')}
                  disabled={!canScrollLeft}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => scrollProjects('right')}
                  disabled={!canScrollRight}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
            {hasProjects && (
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="gap-1">
                  View all
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {projectsLoading ? (
          <div className="flex gap-6 overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse flex-shrink-0 w-[300px]">
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
          <div 
            ref={projectsScrollRef}
            className="flex gap-6 overflow-x-auto scrollbar-hide pb-2 -mx-2 px-2"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            onScroll={checkScrollState}
            onLoad={checkScrollState}
          >
            {recentProjects.map((project) => (
              <div key={project.id} className="flex-shrink-0 w-[300px]">
                <ProjectCard
                  project={project}
                  currentUserId={profile?.id}
                  onProjectUpdate={handleProjectUpdate}
                />
              </div>
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

      {/* Loopers' Gallery (Community Creations Feed) */}
      {(communityCreations.length > 0 || communityLoading) && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Loopers&apos; Gallery</h2>
            <p className="text-sm text-muted-foreground">
              Explore what others are creating
            </p>
          </div>

          {communityLoading && communityCreations.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="aspect-square bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {communityCreations.map((creation) => (
                  <button
                    key={creation.id}
                    onClick={() => setSelectedCreation(creation)}
                    className="group flex flex-col gap-2 text-left focus:outline-none"
                  >
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-muted transition-all group-hover:ring-2 group-hover:ring-primary/50 group-focus-visible:ring-2 group-focus-visible:ring-primary">
                      {creation.fileType === 'video' ? (
                        <video
                          src={creation.fileUrl}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          playsInline
                          onMouseEnter={(e) => e.currentTarget.play()}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause()
                            e.currentTarget.currentTime = 0
                          }}
                        />
                      ) : (
                        <Image
                          src={creation.fileUrl}
                          alt={creation.generation.prompt.slice(0, 100)}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        />
                      )}

                      {/* Video indicator badge */}
                      {creation.fileType === 'video' && (
                        <div className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5">
                          <Play className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Author (always visible) */}
                    <div className="flex items-center gap-2 px-0.5">
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                        {creation.generation.user.avatarUrl ? (
                          <Image
                            src={creation.generation.user.avatarUrl}
                            alt=""
                            width={24}
                            height={24}
                            className="rounded-full"
                          />
                        ) : (
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <span className="text-xs font-medium text-foreground/90 truncate">
                        {creation.generation.user.displayName || 'Anonymous'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Load More Button */}
              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="gap-2"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load more'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onProjectCreated={handleProjectCreated}
      />

      {/* Community Creation Detail Dialog */}
      <CommunityCreationDialog
        creation={selectedCreation}
        open={!!selectedCreation}
        onClose={() => setSelectedCreation(null)}
      />
    </div>
  )
}
