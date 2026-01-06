'use client'

import { useState, useEffect } from 'react'
import { Plus, Image as ImageIcon, Video, Loader2 } from 'lucide-react'
import type { Session } from '@/types/project'

interface FloatingSessionBarProps {
  sessions: Session[]
  activeSession: Session | null
  generationType: 'image' | 'video'
  onSessionSelect: (session: Session) => void
  onSessionCreate: (type: 'image' | 'video') => void
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
}: FloatingSessionBarProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, SessionThumbnail>>({})
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)

  const filteredSessions = sessions.filter((s) => s.type === generationType)

  // Fetch latest image for each session
  useEffect(() => {
    const fetchThumbnails = async () => {
      for (const session of filteredSessions) {
        if (thumbnails[session.id]?.imageUrl !== undefined) continue // Already fetched
        
        setThumbnails(prev => ({
          ...prev,
          [session.id]: { sessionId: session.id, imageUrl: null, isLoading: true }
        }))

        try {
          const response = await fetch(`/api/generations?sessionId=${session.id}&limit=1`)
          if (response.ok) {
            const data = await response.json()
            const generations = data.data || data || []
            const latestGen = generations[0]
            const latestOutput = latestGen?.outputs?.[0]
            
            setThumbnails(prev => ({
              ...prev,
              [session.id]: {
                sessionId: session.id,
                imageUrl: latestOutput?.fileUrl || null,
                isLoading: false
              }
            }))
          }
        } catch (error) {
          console.error('Error fetching thumbnail for session:', session.id, error)
          setThumbnails(prev => ({
            ...prev,
            [session.id]: { sessionId: session.id, imageUrl: null, isLoading: false }
          }))
        }
      }
    }

    fetchThumbnails()
  }, [filteredSessions.map(s => s.id).join(',')])

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-start gap-2">
      {/* New Session Button */}
      <button
        onClick={() => onSessionCreate(generationType)}
        className="w-12 h-12 rounded-xl bg-card/90 backdrop-blur-lg border border-border/50 shadow-lg
          flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50
          transition-all duration-200"
        title={`New ${generationType} session`}
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* Divider */}
      {filteredSessions.length > 0 && (
        <div className="w-6 h-px bg-border/50 my-1 ml-3" />
      )}

      {/* Session Thumbnails - container allows horizontal expansion */}
      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto scrollbar-hide py-1 pr-2">
        {filteredSessions.map((session) => {
          const thumbnail = thumbnails[session.id]
          const isActive = activeSession?.id === session.id
          const isHovered = hoveredSession === session.id

          return (
            <div
              key={session.id}
              className="relative"
              onMouseEnter={() => setHoveredSession(session.id)}
              onMouseLeave={() => setHoveredSession(null)}
            >
              {/* Expandable Session Card - square by default, expands on hover */}
              <button
                onClick={() => onSessionSelect(session)}
                className={`
                  h-12 rounded-xl transition-all duration-200 ease-out
                  border-2 shadow-lg flex items-center gap-3
                  ${isHovered ? 'w-auto pr-4' : 'w-12'}
                  ${isActive 
                    ? 'border-primary ring-2 ring-primary/30 bg-primary/10' 
                    : 'border-border/50 hover:border-primary/50 bg-card/90 backdrop-blur-lg'
                  }
                `}
              >
                {/* Thumbnail */}
                <div className="w-12 h-12 flex-shrink-0 rounded-l-[10px] overflow-hidden">
                  {thumbnail?.isLoading ? (
                    <div className="w-full h-full bg-muted/80 backdrop-blur flex items-center justify-center">
                      <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                    </div>
                  ) : thumbnail?.imageUrl ? (
                    <img
                      src={thumbnail.imageUrl}
                      alt={session.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted/80 backdrop-blur flex items-center justify-center">
                      {session.type === 'video' ? (
                        <Video className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>

                {/* Session Name - visible on hover */}
                {isHovered && (
                  <div className="flex flex-col items-start animate-in fade-in slide-in-from-left-2 duration-150">
                    <span className="text-sm font-medium whitespace-nowrap">
                      {session.name}
                    </span>
                    {session.creator?.displayName && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {session.creator.displayName}
                      </span>
                    )}
                  </div>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {filteredSessions.length === 0 && (
        <div className="w-12 h-12 rounded-xl bg-card/50 border border-dashed border-border/50 
          flex items-center justify-center">
          <span className="text-xs text-muted-foreground">—</span>
        </div>
      )}
    </div>
  )
}

