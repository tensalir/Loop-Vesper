import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Image, Video, Pencil, Check, X, Lock, Globe, Trash2, MoreVertical } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Session } from '@/types/project'

interface SessionSidebarProps {
  sessions: Session[]
  activeSession: Session | null
  generationType: 'image' | 'video'
  projectOwnerId: string
  currentUserId?: string
  onSessionSelect: (session: Session) => void
  onSessionCreate: (type: 'image' | 'video') => void
  onSessionUpdate?: () => void
}

export function SessionSidebar({
  sessions,
  activeSession,
  generationType,
  projectOwnerId,
  currentUserId,
  onSessionSelect,
  onSessionCreate,
  onSessionUpdate,
}: SessionSidebarProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [newSessionName, setNewSessionName] = useState('')
  const [deletingSession, setDeletingSession] = useState<Session | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const filteredSessions = sessions.filter((s) => s.type === generationType)
  const isOwner = currentUserId === projectOwnerId

  // Prefetch generations on hover
  const handlePrefetch = async (session: Session) => {
    if (session.id === activeSession?.id) return
    
    queryClient.prefetchQuery({
      queryKey: ['generations', session.id, 20],
      queryFn: async () => {
        const response = await fetch(`/api/generations?sessionId=${session.id}&limit=20`)
        if (!response.ok) throw new Error('Failed to fetch')
        return response.json()
      },
      staleTime: 30000,
    })
  }

  const handleRenameStart = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingSessionId(session.id)
    setNewSessionName(session.name)
  }

  const handleRenameSubmit = async (sessionId: string) => {
    if (!newSessionName.trim()) return
    
    const trimmedName = newSessionName.trim()
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return
    
    const sessionProjectId = session.projectId
    const previousSessions = queryClient.getQueryData<Session[]>(['sessions', sessionProjectId])
    
    // Optimistic update: immediately update session name in cache
    queryClient.setQueryData(['sessions', sessionProjectId], (oldData: Session[] | undefined) => {
      if (!oldData) return []
      return oldData.map((s) => 
        s.id === sessionId ? { ...s, name: trimmedName } : s
      )
    })
    
    // Close edit mode immediately for better UX
    setRenamingSessionId(null)
    
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) throw new Error('Failed to rename session')

      toast({
        title: "Session renamed",
        description: "Session name updated successfully",
        variant: "default",
      })

      onSessionUpdate?.()
    } catch (error) {
      console.error('Error renaming session:', error)
      
      // Rollback optimistic update on error
      if (previousSessions) {
        queryClient.setQueryData(['sessions', sessionProjectId], previousSessions)
      }
      
      toast({
        title: "Rename failed",
        description: "Failed to update session name",
        variant: "destructive",
      })
    }
  }

  const handleRenameCancel = () => {
    setRenamingSessionId(null)
    setNewSessionName('')
  }

  const handleTogglePrivacy = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!isOwner) {
      toast({
        title: "Permission denied",
        description: "Only the project owner can change session privacy",
        variant: "destructive",
      })
      return
    }

    const newIsPrivate = !session.isPrivate
    const sessionProjectId = session.projectId
    
    // Store previous sessions for potential rollback
    const previousSessions = queryClient.getQueryData<Session[]>(['sessions', sessionProjectId])
    
    // Optimistic update: immediately update session privacy in cache
    queryClient.setQueryData(['sessions', sessionProjectId], (oldData: Session[] | undefined) => {
      if (!oldData) return []
      return oldData.map((s) => 
        s.id === session.id ? { ...s, isPrivate: newIsPrivate } : s
      )
    })

    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: newIsPrivate }),
      })

      if (!response.ok) throw new Error('Failed to update privacy')

      const newStatus = newIsPrivate ? 'Private' : 'Public'
      toast({
        title: "Privacy updated",
        description: `Session is now ${newStatus}`,
        variant: "default",
      })

      onSessionUpdate?.()
    } catch (error) {
      console.error('Error updating privacy:', error)
      
      // Rollback optimistic update on error
      if (previousSessions) {
        queryClient.setQueryData(['sessions', sessionProjectId], previousSessions)
      }
      
      toast({
        title: "Update failed",
        description: "Failed to update session privacy",
        variant: "destructive",
      })
    }
  }

  const handleDeleteStart = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingSession(session)
  }

  const handleDeleteConfirm = async () => {
    if (!deletingSession) return
    
    const sessionToDelete = deletingSession
    const sessionProjectId = sessionToDelete.projectId
    
    // Store previous sessions for potential rollback
    const previousSessions = queryClient.getQueryData<Session[]>(['sessions', sessionProjectId])
    
    // Optimistic update: immediately remove session from cache
    queryClient.setQueryData(['sessions', sessionProjectId], (oldData: Session[] | undefined) => {
      if (!oldData) return []
      return oldData.filter((s) => s.id !== sessionToDelete.id)
    })
    
    // Close dialog immediately for better UX
    setDeletingSession(null)
    setIsDeleting(true)
    
    try {
      const response = await fetch(`/api/sessions/${sessionToDelete.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete session')

      toast({
        title: "Session deleted",
        description: "Session and all its contents have been permanently deleted",
        variant: "default",
      })

      // Also invalidate to ensure consistency (updates in background)
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionProjectId] })
      
      onSessionUpdate?.()
    } catch (error) {
      console.error('Error deleting session:', error)
      
      // Rollback optimistic update on error
      if (previousSessions) {
        queryClient.setQueryData(['sessions', sessionProjectId], previousSessions)
      }
      
      toast({
        title: "Delete failed",
        description: "Failed to delete session. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="w-72 border-r border-border/50 bg-muted/20 flex flex-col p-3 gap-3">
      {/* New Session Card */}
      <div className="bg-card border border-border rounded-lg p-3 shadow-sm">
        <Button
          size="sm"
          className="w-full h-9 text-sm font-medium rounded-lg"
          onClick={() => onSessionCreate(generationType)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </div>

      {/* Sessions List with Card Styling */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {filteredSessions.length === 0 ? (
          <div className="bg-card/50 border border-dashed border-border rounded-lg p-6 text-center">
            <p className="text-sm text-muted-foreground">No {generationType} sessions yet</p>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.id}
              className={`w-full text-left rounded-lg transition-all group ${
                activeSession?.id === session.id
                  ? 'bg-primary text-primary-foreground shadow-md scale-[1.02]'
                  : 'bg-card border border-border hover:border-primary/50 hover:shadow-md'
              }`}
            >
              {renamingSessionId === session.id ? (
                <div className="p-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {session.type === 'image' ? (
                      <Image className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <Video className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    )}
                    <Input
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(session.id)
                        if (e.key === 'Escape') handleRenameCancel()
                      }}
                      autoFocus
                      className="h-7 text-sm flex-1 text-foreground bg-background border-border"
                    />
                    <button
                      onClick={() => handleRenameSubmit(session.id)}
                      className="p-1 rounded hover:bg-primary/20 text-green-600 hover:text-green-700 transition-colors"
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleRenameCancel}
                      className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      title="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => onSessionSelect(session)}
                  onMouseEnter={() => handlePrefetch(session)}
                  className="w-full text-left cursor-pointer"
                >
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      {session.type === 'image' ? (
                        <Image className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Video className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{session.name}</p>
                            <p className={`text-xs mt-1 ${
                              activeSession?.id === session.id 
                                ? 'text-primary-foreground/80' 
                                : 'text-muted-foreground'
                            }`}>
                              {new Date(session.updatedAt).toLocaleDateString()}
                            </p>
                            {session.creator?.displayName && (
                              <p className={`text-xs ${
                                activeSession?.id === session.id 
                                  ? 'text-primary-foreground/60' 
                                  : 'text-muted-foreground/70'
                              }`}>
                                {session.creator.displayName}
                              </p>
                            )}
                          </div>
                          {/* Top Right: Menu and Privacy Toggle */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Three Dots Menu */}
                            {isOwner && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    onClick={(e) => e.stopPropagation()}
                                    className={`p-1 rounded hover:bg-white/10 ${
                                      activeSession?.id === session.id ? 'text-primary-foreground' : 'text-muted-foreground'
                                    }`}
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRenameStart(session, e); }}>
                                    <Pencil className="h-3.5 w-3.5 mr-2" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={(e) => { e.stopPropagation(); handleDeleteStart(session, e); }}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            
                            {/* Privacy Toggle */}
                            {isOwner ? (
                              <button
                                onClick={(e) => handleTogglePrivacy(session, e)}
                                className={`rounded-full p-0.5 flex items-center gap-0.5 transition-all relative ${
                                  activeSession?.id === session.id
                                    ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                                    : 'bg-white/10 hover:bg-white/20'
                                }`}
                                title={session.isPrivate ? 'Click to make public' : 'Click to make private'}
                              >
                                {/* Lock Icon - Left */}
                                <div className={`p-1 rounded-full transition-all z-10 ${
                                  session.isPrivate
                                    ? activeSession?.id === session.id ? 'text-primary' : 'text-background'
                                    : activeSession?.id === session.id ? 'text-primary-foreground/60' : 'text-muted-foreground'
                                }`}>
                                  <Lock className="h-3 w-3" />
                                </div>
                                
                                {/* Globe Icon - Right */}
                                <div className={`p-1 rounded-full transition-all z-10 ${
                                  !session.isPrivate
                                    ? activeSession?.id === session.id ? 'text-primary' : 'text-background'
                                    : activeSession?.id === session.id ? 'text-primary-foreground/60' : 'text-muted-foreground'
                                }`}>
                                  <Globe className="h-3 w-3" />
                                </div>

                                {/* Sliding Background */}
                                <div
                                  className={`absolute top-0.5 bottom-0.5 w-6 rounded-full transition-all duration-300 ${
                                    activeSession?.id === session.id ? 'bg-primary-foreground' : 'bg-primary'
                                  } ${
                                    !session.isPrivate ? 'left-[calc(50%-1px)]' : 'left-0.5'
                                  }`}
                                />
                              </button>
                            ) : (
                              <div className="rounded-full p-0.5 flex items-center gap-0.5 bg-white/5 opacity-50">
                                <div className={`p-1 ${session.isPrivate ? 'opacity-100' : 'opacity-40'}`}>
                                  <Lock className="h-3 w-3 text-muted-foreground" />
                                </div>
                                <div className={`p-1 ${!session.isPrivate ? 'opacity-100' : 'opacity-40'}`}>
                                  <Globe className="h-3 w-3 text-primary" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deletingSession}
        onOpenChange={(open) => !open && setDeletingSession(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Session?"
        description={`Are you sure you want to delete "${deletingSession?.name}"? This will permanently delete all generations and images in this session. This action cannot be undone.`}
        confirmText={isDeleting ? "Deleting..." : "Delete Session"}
        cancelText="Cancel"
        variant="destructive"
      />
    </div>
  )
}

