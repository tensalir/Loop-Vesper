import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Users, Globe, User, Pencil, Check, Trash2 } from 'lucide-react'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useQueryClient, InfiniteData } from '@tanstack/react-query'
import type { Project } from '@/types/project'
import { getSessions } from '@/lib/api/sessions'
import { fetchGenerationsPage, PaginatedGenerationsResponse } from '@/lib/api/generations'

interface ProjectCardProps {
  project: Project
  currentUserId?: string
  onProjectUpdate?: () => void
}

export function ProjectCard({ project, currentUserId, onProjectUpdate }: ProjectCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [updating, setUpdating] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editedName, setEditedName] = useState(project.name)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [optimisticProject, setOptimisticProject] = useState<Project>(project)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasPrefetchedRef = useRef(false)

  // Update optimistic project when prop changes (from parent refetch)
  useEffect(() => {
    setOptimisticProject(project)
  }, [project])

  // Use optimistic project for display
  const displayProject = optimisticProject
  
  // Sync editedName when project name changes externally
  useEffect(() => {
    if (!isEditingName) {
      setEditedName(displayProject.name)
    }
  }, [displayProject.name, isEditingName])
  const isOwner = !!currentUserId && displayProject.ownerId === currentUserId
  const thumbnailUrl = displayProject.thumbnailUrl || null

  const handleMouseEnter = () => {
    if (hasPrefetchedRef.current) return

    hoverTimeoutRef.current = setTimeout(async () => {
      try {
        const sessions = await queryClient.fetchQuery({
          queryKey: ['sessions', project.id],
          queryFn: () => getSessions(project.id),
          staleTime: 5 * 60 * 1000,
        })

        if (sessions && sessions.length > 0 && sessions[0].id) {
          const firstSession = sessions[0]
          const firstPage = await fetchGenerationsPage({
            sessionId: firstSession.id,
            limit: 10,
          })

          const infinitePayload: InfiniteData<PaginatedGenerationsResponse> = {
            pageParams: [undefined],
            pages: [firstPage],
          }

          queryClient.setQueryData(['generations', 'infinite', firstSession.id], infinitePayload)
        }
      } catch (error) {
        console.error('Error prefetching project data:', error)
      }

      hasPrefetchedRef.current = true
    }, 200)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
  }

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  const handleClick = () => {
    if (!isEditingName) {
      router.push(`/projects/${displayProject.id}`)
    }
  }

  const handleEditName = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditedName(optimisticProject.name)
    setIsEditingName(true)
  }

  const handleSaveName = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editedName.trim() || editedName === displayProject.name) {
      setIsEditingName(false)
      setEditedName(displayProject.name)
      return
    }

    setUpdating(true)
    try {
      const response = await fetch(`/api/projects/${displayProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editedName.trim() }),
      })

      if (response.ok) {
        // Optimistic UI update for name
        setOptimisticProject({
          ...displayProject,
          name: editedName.trim(),
        })
        toast({
          title: 'Project renamed',
          description: `Project renamed to "${editedName.trim()}"`,
          variant: 'default',
        })
        setIsEditingName(false)
        onProjectUpdate?.()
      } else {
        throw new Error('Failed to update name')
      }
    } catch (error) {
      console.error('Error updating name:', error)
      toast({
        title: 'Update failed',
        description: 'Failed to update project name',
        variant: 'destructive',
      })
      setEditedName(displayProject.name)
    } finally {
      setUpdating(false)
    }
  }

  const handleTogglePrivacy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOwner) return

    const newIsShared = !displayProject.isShared
    
    // Optimistic UI update - immediately reflect the change
    setOptimisticProject({
      ...displayProject,
      isShared: newIsShared,
    })

    setUpdating(true)
    try {
      const response = await fetch(`/api/projects/${displayProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShared: newIsShared }),
      })

      if (response.ok) {
        toast({
          title: displayProject.isShared ? 'Project set to private' : 'Sharing enabled',
          description: displayProject.isShared
            ? 'Only you can see this project now'
            : 'Invited members can now view this project',
          variant: 'default',
        })
        // Trigger refetch with cache bypass to get fresh data
        onProjectUpdate?.()
      } else {
        // Revert optimistic update on error
        setOptimisticProject(displayProject)
        throw new Error('Failed to update privacy')
      }
    } catch (error) {
      // Revert optimistic update on error
      setOptimisticProject(displayProject)
      console.error('Error updating privacy:', error)
      toast({
        title: 'Update failed',
        description: 'Failed to update project privacy',
        variant: 'destructive',
      })
    } finally {
      setUpdating(false)
    }
  }

  const handleDeleteStart = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    
    // Store previous data for potential rollback
    const previousProjects = queryClient.getQueryData<(Project & { thumbnailUrl?: string | null })[]>(['projects'])
    
    // Optimistic update: immediately remove project from cache
    queryClient.setQueryData(['projects'], (oldData: (Project & { thumbnailUrl?: string | null })[] | undefined) => {
      if (!oldData) return []
      return oldData.filter((p) => p.id !== displayProject.id)
    })
    
    // Close dialog immediately for better UX
    setShowDeleteDialog(false)
    
    try {
      const response = await fetch(`/api/projects/${displayProject.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete project')

      toast({
        title: "Project deleted",
        description: "Project and all its contents have been permanently deleted",
        variant: "default",
      })

      // Navigate back to projects page
      router.push('/projects')
      onProjectUpdate?.()
    } catch (error) {
      console.error('Error deleting project:', error)
      
      // Rollback optimistic update on error
      if (previousProjects) {
        queryClient.setQueryData(['projects'], previousProjects)
      }
      
      toast({
        title: "Delete failed",
        description: "Failed to delete project. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getOwnerName = () => {
    if (!displayProject.owner) return 'Unknown'
    return displayProject.owner.displayName || displayProject.owner.username || 'Unknown'
  }

  return (
    <Card
      className="cursor-pointer hover:border-primary transition-colors group"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CardContent className="p-0">
        <div className="aspect-video bg-muted relative overflow-hidden">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={displayProject.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-4xl text-muted-foreground">
                {displayProject.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            {isOwner ? (
              <button
                type="button"
                onClick={handleTogglePrivacy}
                disabled={updating}
                className="bg-background/90 backdrop-blur-sm rounded-full p-1 flex items-center gap-0.5 hover:bg-background/95 transition-all relative"
                title={
                  displayProject.isShared
                    ? 'Public (visible in Community Creations). Click to make private.'
                    : 'Private (hidden from Community Creations). Click to make public.'
                }
              >
                {/* Lock Icon - Left */}
                <div className={`p-1.5 rounded-full transition-all z-10 ${
                  !displayProject.isShared 
                    ? 'text-background' 
                    : 'text-muted-foreground'
                }`}>
                  <Lock className="h-3.5 w-3.5" />
                </div>
                
                {/* Globe Icon - Right */}
                <div className={`p-1.5 rounded-full transition-all z-10 ${
                  displayProject.isShared 
                    ? 'text-background' 
                    : 'text-muted-foreground'
                }`}>
                  <Globe className="h-3.5 w-3.5" />
                </div>

                {/* Sliding Background */}
                <div
                  className={`absolute top-1 bottom-1 w-7 bg-primary rounded-full transition-all duration-300 ${
                    displayProject.isShared ? 'left-[calc(50%-2px)]' : 'left-1'
                  }`}
                />
              </button>
            ) : (
              <div
                className="bg-background/80 backdrop-blur-sm rounded-full p-1 flex items-center gap-0.5 cursor-default"
                onClick={(e) => e.stopPropagation()}
                title="Only the project owner can change Community visibility"
              >
                <div className={`p-1.5 ${!displayProject.isShared ? 'opacity-100' : 'opacity-40'}`}>
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className={`p-1.5 ${displayProject.isShared ? 'opacity-100' : 'opacity-40'}`}>
                  <Globe className="h-3.5 w-3.5 text-primary" />
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start p-4 space-y-1">
            {isEditingName ? (
          <div className="flex items-center gap-2 w-full" onClick={(e) => e.stopPropagation()}>
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveName(e as any)
                } else if (e.key === 'Escape') {
                  setIsEditingName(false)
                  setEditedName(displayProject.name)
                }
              }}
              className="text-lg font-semibold h-9 text-foreground bg-background border-border"
              autoFocus
              disabled={updating}
            />
            <button
              onClick={handleSaveName}
              disabled={updating}
              className="p-2 hover:bg-primary/10 rounded-lg transition-colors"
              title="Save name"
            >
              <Check className="h-4 w-4 text-primary" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 w-full group/title">
            <h3 className="font-semibold text-lg group-hover:text-primary transition-colors flex-1">
              {displayProject.name}
            </h3>
            {isOwner && (
              <>
                <button
                  onClick={handleEditName}
                  className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-muted rounded transition-all"
                  title="Rename project"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={handleDeleteStart}
                  className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-destructive/20 rounded transition-all"
                  title="Delete project"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </>
            )}
          </div>
        )}
        {displayProject.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {displayProject.description}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground w-full">
          <User className="h-3 w-3" />
          <span>{getOwnerName()}</span>
          <span>•</span>
          <span>{formatDate(displayProject.updatedAt)}</span>
        </div>
        {typeof displayProject.sessionCount === 'number' && (
          <div className="text-xs text-muted-foreground">
            {displayProject.sessionCount} {displayProject.sessionCount === 1 ? 'session' : 'sessions'}
          </div>
        )}
      </CardFooter>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleDeleteConfirm}
        title="Delete Project?"
        description={`⚠️ WARNING: You are about to delete "${displayProject.name}" and ALL of its contents, including all sessions, generations, and images. This action is PERMANENT and CANNOT be undone. Are you absolutely sure?`}
        confirmText={isDeleting ? "Deleting..." : "Delete Forever"}
        cancelText="Cancel"
        variant="destructive"
      />
    </Card>
  )
}

