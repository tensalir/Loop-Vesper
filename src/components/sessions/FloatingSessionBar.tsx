'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Image as ImageIcon, Video, Loader2, Pencil, Trash2, Check, X } from 'lucide-react'
import { fetchGenerationsPage } from '@/lib/api/generations'
import type { Session } from '@/types/project'
import { toViewUrl } from '@/lib/storage/refs'

interface FloatingSessionBarProps {
  sessions: Session[]
  activeSession: Session | null
  generationType: 'image' | 'video'
  onSessionSelect: (session: Session) => void
  onSessionCreate: (type: 'image' | 'video') => void
  onSessionRename?: (session: Session, newName: string) => Promise<void>
  onSessionDelete?: (session: Session) => void
}

interface SessionThumbnail {
  sessionId: string
  imageUrl: string | null
  isLoading: boolean
}

export function FloatingSessionBar({
  sessions,
  activeSession,
  generationType,
  onSessionSelect,
  onSessionCreate,
  onSessionRename,
  onSessionDelete,
}: FloatingSessionBarProps) {
  const queryClient = useQueryClient()
  const [thumbnails, setThumbnails] = useState<Record<string, SessionThumbnail>>({})
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const prefetchedSessionsRef = useRef<Set<string>>(new Set())

  // Prefetch a session's generations on hover for instant switching
  const handleSessionHover = useCallback((sessionId: string) => {
    setHoveredSession(sessionId)
    
    // Skip if already prefetched, is the active session, or is a temp session
    if (
      prefetchedSessionsRef.current.has(sessionId) ||
      activeSession?.id === sessionId ||
      sessionId.startsWith('temp-')
    ) {
      return
    }

    // Mark as prefetched
    prefetchedSessionsRef.current.add(sessionId)

    // Prefetch the first page of generations (limit 5) so gallery renders instantly on switch
    queryClient.prefetchInfiniteQuery({
      queryKey: ['generations', 'infinite', sessionId],
      queryFn: () => fetchGenerationsPage({ sessionId, limit: 5 }),
      initialPageParam: undefined,
      staleTime: 30 * 1000, // 30 seconds
    })
  }, [queryClient, activeSession?.id])

  // Focus input when editing starts
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingSessionId])

  const handleStartEditing = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditingName(session.name)
  }

  const handleSaveEdit = async () => {
    if (!editingSessionId || !editingName.trim() || isSaving) return
    
    const session = sessions.find(s => s.id === editingSessionId)
    if (!session || session.name === editingName.trim()) {
      setEditingSessionId(null)
      return
    }

    setIsSaving(true)
    try {
      await onSessionRename?.(session, editingName.trim())
    } finally {
      setIsSaving(false)
      setEditingSessionId(null)
    }
  }

  const handleCancelEdit = () => {
    setEditingSessionId(null)
    setEditingName('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  const filteredSessions = useMemo(
    () => sessions
      .filter((s) => s.type === generationType)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions, generationType]
  )
  
  // Create a stable dependency key for filtered sessions
  const filteredSessionIds = useMemo(
    () => filteredSessions.map(s => s.id).join(','),
    [filteredSessions]
  )

  // Get projectId from the first session (all sessions in props belong to the same project)
  const projectId = sessions[0]?.projectId

  // Fetch thumbnails for all sessions in a single bulk request
  useEffect(() => {
    if (!projectId || filteredSessions.length === 0) return

    // Set loading state for all non-temp sessions
    const initialThumbnails: Record<string, SessionThumbnail> = {}
    for (const session of filteredSessions) {
      const isTempSession = session.id.startsWith('temp-')
      initialThumbnails[session.id] = {
        sessionId: session.id,
        imageUrl: null,
        isLoading: !isTempSession,
      }
    }
    setThumbnails(initialThumbnails)

    // Fetch all thumbnails in one request
    const fetchBulkThumbnails = async () => {
      try {
        const params = new URLSearchParams({ projectId, type: generationType })
        const response = await fetch(`/api/sessions/thumbnails?${params}`)
        
        if (response.ok) {
          const data = await response.json()
          const bulkThumbnails: Record<string, string | null> = data.thumbnails || {}
          
          // Update state with fetched thumbnails
          setThumbnails(prev => {
            const updated = { ...prev }
            for (const session of filteredSessions) {
              if (session.id.startsWith('temp-')) continue
              updated[session.id] = {
                sessionId: session.id,
                imageUrl: bulkThumbnails[session.id] || null,
                isLoading: false,
              }
            }
            return updated
          })
        } else {
          // On error, clear loading state
          setThumbnails(prev => {
            const updated = { ...prev }
            for (const sessionId of Object.keys(updated)) {
              updated[sessionId] = { ...updated[sessionId], isLoading: false }
            }
            return updated
          })
        }
      } catch (error) {
        console.error('Error fetching bulk thumbnails:', error)
        // Clear loading state on error
        setThumbnails(prev => {
          const updated = { ...prev }
          for (const sessionId of Object.keys(updated)) {
            updated[sessionId] = { ...updated[sessionId], isLoading: false }
          }
          return updated
        })
      }
    }

    fetchBulkThumbnails()
  }, [projectId, generationType, filteredSessionIds, filteredSessions])

  return (
    <div className="flex flex-col items-start gap-3">
      {/* New Session Button */}
      <button
        onClick={() => onSessionCreate(generationType)}
        className="w-14 h-14 rounded-2xl bg-card/90 backdrop-blur-lg border border-border/50 shadow-lg
          flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50
          transition-all duration-300"
        title={`New ${generationType} session`}
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Divider */}
      {filteredSessions.length > 0 && (
        <div className="w-8 h-px bg-border/50 ml-3" />
      )}

      {/* Session Thumbnails */}
      <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto scrollbar-hide py-1">
        {filteredSessions.map((session) => {
          const thumbnail = thumbnails[session.id]
          const isActive = activeSession?.id === session.id
          const isHovered = hoveredSession === session.id

          return (
            <div
              key={session.id}
              className="relative"
              onMouseEnter={() => handleSessionHover(session.id)}
              onMouseLeave={() => setHoveredSession(null)}
            >
              {/* Fluid Expandable Session Card */}
              <div
                className={`
                  relative rounded-2xl overflow-hidden
                  border-2 shadow-lg backdrop-blur-lg
                  transition-all duration-300 ease-out
                  ${isActive 
                    ? 'border-primary ring-2 ring-primary/30' 
                    : 'border-border/50 hover:border-primary/50'
                  }
                `}
                style={{
                  width: isHovered ? '220px' : '56px',
                  height: isHovered ? '80px' : '56px',
                }}
              >
                {/* Background - thumbnail or placeholder */}
                <div className="absolute inset-0">
                  {thumbnail?.isLoading ? (
                    <div className="w-full h-full bg-card/95 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                    </div>
                  ) : thumbnail?.imageUrl ? (
                    <>
                      <img
                        src={toViewUrl(thumbnail.imageUrl)}
                        alt={session.name}
                        className="w-full h-full object-cover"
                      />
                      {/* Gradient overlay for text readability when expanded */}
                      <div 
                        className="absolute inset-0 transition-opacity duration-300"
                        style={{
                          background: isHovered 
                            ? 'linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%)'
                            : 'none',
                          opacity: isHovered ? 1 : 0,
                        }}
                      />
                    </>
                  ) : (
                    <div className="w-full h-full bg-card/95 flex items-center justify-center">
                      {session.type === 'video' ? (
                        <Video className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>

                {/* Content Layer */}
                {editingSessionId === session.id ? (
                  /* Editing mode */
                  <div 
                    className="relative w-full h-full flex items-center px-3 gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onBlur={handleSaveEdit}
                      className="flex-1 bg-black/50 text-white text-sm font-semibold px-2 py-1 rounded border border-white/30 focus:border-primary focus:outline-none"
                      disabled={isSaving}
                    />
                    <button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="p-1 rounded bg-primary hover:bg-primary/80 transition-colors"
                      title="Save"
                    >
                      {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-white" />
                      )}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 rounded bg-white/20 hover:bg-white/30 transition-colors"
                      title="Cancel"
                    >
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                ) : (
                  /* Normal display mode */
                  <button
                    onClick={() => onSessionSelect(session)}
                    className="relative w-full h-full flex items-center cursor-pointer"
                  >
                    {/* Session info - visible when expanded */}
                    <div 
                      className="flex flex-col items-start justify-center px-4 transition-opacity duration-200"
                      style={{
                        opacity: isHovered ? 1 : 0,
                        pointerEvents: isHovered ? 'auto' : 'none',
                      }}
                    >
                      <span className="text-sm font-semibold text-white whitespace-nowrap drop-shadow-md">
                        {session.name}
                      </span>
                      {session.creator?.displayName && (
                        <span className="text-xs text-white/70 whitespace-nowrap drop-shadow-md">
                          {session.creator.displayName}
                        </span>
                      )}
                    </div>
                  </button>
                )}

                {/* Action buttons - visible when expanded and not editing */}
                {editingSessionId !== session.id && (
                  <div 
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 transition-opacity duration-200"
                    style={{
                      opacity: isHovered ? 1 : 0,
                      pointerEvents: isHovered ? 'auto' : 'none',
                    }}
                  >
                    {onSessionRename && (
                      <button
                        onClick={(e) => handleStartEditing(session, e)}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                        title="Rename session"
                      >
                        <Pencil className="h-3.5 w-3.5 text-white" />
                      </button>
                    )}
                    {onSessionDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSessionDelete(session)
                        }}
                        className="p-1.5 rounded-lg bg-white/20 hover:bg-red-500/80 transition-colors"
                        title="Delete session"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      </button>
                    )}
                  </div>
                )}

                {/* Active indicator dot */}
                {isActive && !isHovered && (
                  <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-primary shadow-lg" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {filteredSessions.length === 0 && (
        <div className="w-14 h-14 rounded-2xl bg-card/50 border border-dashed border-border/50 
          flex items-center justify-center">
          <span className="text-xs text-muted-foreground">—</span>
        </div>
      )}
    </div>
  )
}

