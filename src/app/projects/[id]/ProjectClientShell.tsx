'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Settings, Sun, Moon, Lock, Globe, Loader2, FileText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { FloatingSessionBar } from '@/components/sessions/FloatingSessionBar'
import { useSessions } from '@/hooks/useSessions'
import { Navbar } from '@/components/navbar/Navbar'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { logMetric } from '@/lib/metrics'
import { fetchGenerationsPage } from '@/lib/api/generations'
import type { Session, Project } from '@/types/project'

/**
 * Check if we should skip prefetching due to network conditions.
 * Returns true if prefetching should be skipped.
 */
function shouldSkipPrefetch(): boolean {
  if (typeof navigator === 'undefined') return false
  
  const connection = (navigator as any).connection
  if (!connection) return false
  
  // Skip if user has Save-Data enabled
  if (connection.saveData) return true
  
  // Skip on very slow connections (2g, slow-2g)
  const slowTypes = ['slow-2g', '2g']
  if (slowTypes.includes(connection.effectiveType)) return true
  
  return false
}

// Loading skeleton for the generation interface
function GenerationInterfaceSkeleton() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background animate-pulse">
      <div className="w-full max-w-2xl px-4 space-y-4">
        {/* Gallery skeleton */}
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="aspect-square bg-muted rounded-lg" />
          ))}
        </div>
        {/* Input skeleton */}
        <div className="h-24 bg-muted rounded-lg" />
      </div>
    </div>
  )
}

// Loading skeleton for session bar
function SessionBarSkeleton() {
  return (
    <div className="flex flex-col gap-2 animate-pulse">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="w-12 h-12 bg-muted rounded-lg" />
      ))}
    </div>
  )
}

// Defer non-critical UI components to reduce initial bundle and improve first paint
const BrainstormChatWidget = dynamic(
  () => import('@/components/brainstorm/BrainstormChatWidget').then(mod => ({ default: mod.BrainstormChatWidget })),
  { ssr: false }
)
const PinnedImagesRail = dynamic(
  () => import('@/components/projects/PinnedImagesRail').then(mod => ({ default: mod.PinnedImagesRail })),
  { ssr: false }
)
const SpendingTracker = dynamic(
  () => import('@/components/navbar/SpendingTracker').then(mod => ({ default: mod.SpendingTracker })),
  { ssr: false }
)
const GeminiRateLimitTracker = dynamic(
  () => import('@/components/navbar/GeminiRateLimitTracker').then(mod => ({ default: mod.GeminiRateLimitTracker })),
  { ssr: false }
)

// Defer heavy GenerationInterface component with loading skeleton
const GenerationInterface = dynamic(
  () => import('@/components/generation/GenerationInterface').then(mod => ({ default: mod.GenerationInterface })),
  { 
    ssr: false,
    loading: () => <GenerationInterfaceSkeleton />
  }
)

// Track page load start time
const pageLoadStart = typeof performance !== 'undefined' ? performance.now() : Date.now()

interface ProjectClientShellProps {
  projectId: string
  initialProject: Project | null
  initialUserId: string | null
  initialIsAdmin: boolean
}

export function ProjectClientShell({
  projectId,
  initialProject,
  initialUserId,
  initialIsAdmin,
}: ProjectClientShellProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [project, setProject] = useState<Project | null>(initialProject)
  const [projectName, setProjectName] = useState(initialProject?.name || 'Loading...')
  const [projectOwnerId, setProjectOwnerId] = useState<string>(initialProject?.ownerId || '')
  const [currentUserId, setCurrentUserId] = useState<string>(initialUserId || '')
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin)
  const [updating, setUpdating] = useState(false)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [generationType, setGenerationType] = useState<'image' | 'video'>('image')
  const [surfaceMode, setSurfaceMode] = useState<'image' | 'video' | 'editor'>('image')
  // Track last active session ID for each type so we can restore it when switching tabs
  const lastActiveSessionByTypeRef = useRef<{ image: string | null; video: string | null }>({
    image: null,
    video: null,
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    // Initialize from DOM class or default to dark
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }
    return 'dark' // Default to dark for SSR
  })
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [externalPrompt, setExternalPrompt] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('prefillPrompt') ?? ''
    }
    return ''
  })
  const [pendingPinnedImageUrl, setPendingPinnedImageUrl] = useState<string | null>(null)
  const [showBriefingModal, setShowBriefingModal] = useState(false)
  const [briefing, setBriefing] = useState('')
  const [isSavingBriefing, setIsSavingBriefing] = useState(false)
  const [briefingLoaded, setBriefingLoaded] = useState(false)
  // Deep-link support: outputId from URL for scroll-to-output
  const [deepLinkOutputId, setDeepLinkOutputId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('outputId')
    }
    return null
  })
  const supabase = createClient()
  const queryClient = useQueryClient()
  const hasProcessedInitialSessionsRef = useRef(false)
  // Track if we've consumed the URL session/output params (to avoid re-processing on re-renders)
  const hasConsumedUrlParamsRef = useRef(false)
  const sessionsReadyLoggedRef = useRef(false)
  const projectReadyLoggedRef = useRef(!!initialProject) // Already logged if we have initial data
  const canManageSessions = Boolean(projectOwnerId && currentUserId && projectOwnerId === currentUserId)

  // Use React Query for sessions with intelligent caching (will use prefetched data)
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions(projectId)

  const { data: brandWorldLink } = useQuery<{ source: string; createdAt: string } | null>({
    queryKey: ['brand-world-link', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/brand-world/projects?mode=linked`)
      if (!res.ok) return null
      const projects: { id: string; brandWorldSettings: { source: string; createdAt: string } | null }[] = await res.json()
      const match = projects.find((p) => p.id === projectId)
      return match?.brandWorldSettings ?? null
    },
    enabled: isAdmin,
    staleTime: 60_000,
  })

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDarkClass = document.documentElement.classList.contains('dark')
    
    // Priority: localStorage > current DOM class > system preference > default to dark
    const resolvedTheme = savedTheme || (isDarkClass ? 'dark' : (systemPrefersDark ? 'dark' : 'dark'))
    
    setTheme(resolvedTheme)
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  // If no initial project, fetch it client-side (fallback)
  useEffect(() => {
    if (!initialProject) {
      fetchProject()
    }
  }, [projectId, initialProject])

  // Set active session when sessions data loads (do NOT auto-create sessions)
  useEffect(() => {
    if (sessionsLoading) return

    const isFirstProcess = !hasProcessedInitialSessionsRef.current
    if (isFirstProcess) {
      hasProcessedInitialSessionsRef.current = true
    }

    // Log timing metric when sessions first become ready
    if (!sessionsReadyLoggedRef.current) {
      sessionsReadyLoggedRef.current = true
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      logMetric({
        name: 'client_sessions_ready',
        status: 'success',
        durationMs: Math.round(now - pageLoadStart),
        meta: {
          projectId,
          sessionCount: sessions.length,
          prefetched: true,
        },
      })
    }

    const urlSessionId =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('sessionId')
        : null

    if (sessions.length === 0) {
      if (activeSession) setActiveSession(null)
      return
    }

    // PRIORITY 1: On first load, if URL has sessionId, use that session
    // This fixes deep-links from Bookmarks/Review/Gallery opening the wrong session
    if (isFirstProcess && urlSessionId && !hasConsumedUrlParamsRef.current) {
      const matchingSession = sessions.find((s) => s.id === urlSessionId)
      if (matchingSession) {
        hasConsumedUrlParamsRef.current = true
        setActiveSession(matchingSession)
        setGenerationType(matchingSession.type)
        return
      }
    }

    if (activeSession) {
      const updatedActiveSession = sessions.find((s) => s.id === activeSession.id)
      setActiveSession(updatedActiveSession || null)
      return
    }

    // If the user has selected a type, prefer a session of that type (if any)
    const sessionsOfType = sessions.filter((s) => s.type === generationType)
    if (sessionsOfType.length > 0) {
      setActiveSession(sessionsOfType[0])
      return
    }

    // Only on first load: fall back to the newest session and adopt its type
    if (isFirstProcess) {
      setActiveSession(sessions[0])
      setGenerationType(sessions[0].type)
    }
  }, [sessionsLoading, sessions, activeSession, generationType, projectId])

  // Track last active session for each type (for tab switching)
  useEffect(() => {
    if (activeSession) {
      lastActiveSessionByTypeRef.current[activeSession.type] = activeSession.id
    }
  }, [activeSession])

  // Track which sessions we've already prefetched
  const prefetchedSessionsRef = useRef<Set<string>>(new Set())

  // Prefetch nearby sessions in the background for instant switching
  useEffect(() => {
    if (sessionsLoading || !activeSession) return
    
    // Skip prefetching on slow networks or if user has Save-Data enabled
    if (shouldSkipPrefetch()) return

    // Get other sessions of the same type (excluding active)
    const otherSessions = sessions
      .filter(s => s.id !== activeSession.id && s.type === generationType && !s.id.startsWith('temp-'))
      .slice(0, 3) // Prefetch up to 3 nearby sessions

    if (otherSessions.length === 0) return

    // Schedule prefetching on idle (low priority)
    const schedulePrefetch = (callback: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 3000 })
      } else {
        setTimeout(callback, 500)
      }
    }

    schedulePrefetch(() => {
      for (const session of otherSessions) {
        // Skip if already prefetched
        if (prefetchedSessionsRef.current.has(session.id)) continue
        prefetchedSessionsRef.current.add(session.id)

        // Prefetch the first page (limit 5) so gallery can render immediately on switch
        queryClient.prefetchInfiniteQuery({
          queryKey: ['generations', 'infinite', session.id],
          queryFn: () => fetchGenerationsPage({ sessionId: session.id, limit: 5 }),
          initialPageParam: undefined,
          staleTime: 30 * 1000, // 30 seconds
        })
      }
    })
  }, [sessionsLoading, activeSession, sessions, generationType, queryClient])

  const fetchProject = async () => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setCurrentUserId(user.id)
        
        // Fetch user profile to check admin status
        const profileResponse = await fetch('/api/profile')
        if (profileResponse.ok) {
          const profile = await profileResponse.json()
          setIsAdmin(profile.role === 'admin')
        }
      }

      // Fetch project details
      const response = await fetch(`/api/projects/${projectId}`)
      if (response.ok) {
        const projectData = await response.json()
        setProject(projectData)
        setProjectName(projectData.name)
        setProjectOwnerId(projectData.ownerId)
        
        // Log timing metric when project first becomes ready
        if (!projectReadyLoggedRef.current) {
          projectReadyLoggedRef.current = true
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
          logMetric({
            name: 'client_project_ready',
            status: 'success',
            durationMs: Math.round(now - pageLoadStart),
            meta: {
              projectId,
            },
          })
        }
      }
    } catch (error) {
      console.error('Error fetching project:', error)
    }
  }

  const handleTogglePrivacy = async () => {
    if (!project || project.ownerId !== currentUserId) return

    const newIsShared = !project.isShared
    
    // Optimistic UI update
    setProject({
      ...project,
      isShared: newIsShared,
    })

    setUpdating(true)
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isShared: newIsShared }),
      })

      if (response.ok) {
        toast({
          title: newIsShared ? 'Sharing enabled' : 'Project set to private',
          description: newIsShared
            ? 'Invited members can now view this project'
            : 'Only you can see this project now',
          variant: 'default',
        })
      } else {
        // Revert optimistic update on error
        setProject(project)
        throw new Error('Failed to update privacy')
      }
    } catch (error) {
      // Revert optimistic update on error
      setProject(project)
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

  // Fetch briefing when modal opens
  const fetchBriefing = async () => {
    if (!projectId || briefingLoaded) return
    try {
      const response = await fetch(`/api/projects/${projectId}/briefing`)
      if (response.ok) {
        const data = await response.json()
        setBriefing(data.briefing || '')
        setBriefingLoaded(true)
      }
    } catch (error) {
      console.error('Error fetching briefing:', error)
    }
  }

  // Save briefing
  const saveBriefing = async () => {
    if (!projectId) return
    setIsSavingBriefing(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/briefing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing }),
      })
      if (response.ok) {
        toast({
          title: 'Briefing saved',
          description: 'Your project briefing has been updated.',
        })
        setShowBriefingModal(false)
      } else {
        throw new Error('Failed to save briefing')
      }
    } catch (error) {
      console.error('Error saving briefing:', error)
      toast({
        title: 'Save failed',
        description: 'Failed to save project briefing',
        variant: 'destructive',
      })
    } finally {
      setIsSavingBriefing(false)
    }
  }

  // Handle opening briefing modal
  const handleOpenBriefing = () => {
    setShowBriefingModal(true)
    if (!briefingLoaded) {
      fetchBriefing()
    }
  }

  const handleSessionCreate = async (
    type: 'image' | 'video', 
    name?: string,
    options?: { skipSwitch?: boolean }
  ): Promise<Session | null> => {
    const sessionName = name || `${type === 'image' ? 'Image' : 'Video'} Session ${sessions.length + 1}`
    const skipSwitch = options?.skipSwitch ?? false
    
    // Create optimistic session with temporary ID
    const tempId = `temp-${Date.now()}`
    const now = new Date()
    const optimisticSession: Session = {
      id: tempId,
      projectId,
      name: sessionName,
      type,
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
    }
    
    // Optimistic update: immediately add to cache
    queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
      if (!oldData) return [optimisticSession]
      return [...oldData, optimisticSession]
    })
    
    // Only switch active session and generation type if not skipped
    // (e.g., when creating from ImageToVideoOverlay, we want to stay in image view)
    if (!skipSwitch) {
      setActiveSession(optimisticSession)
      setGenerationType(type)
    }
    
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          name: sessionName,
          type,
        }),
      })

      if (response.ok) {
        const newSession = await response.json()
        // Parse dates from strings to Date objects
        const parsedSession: Session = {
          ...newSession,
          createdAt: new Date(newSession.createdAt),
          updatedAt: new Date(newSession.updatedAt),
        }
        
        // Replace temporary session with real one in cache
        queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
          if (!oldData) return [parsedSession]
          return oldData.map(s => s.id === tempId ? parsedSession : s)
        })
        // Invalidate projects cache so session count updates on home page
        queryClient.invalidateQueries({ queryKey: ['projects'] })
        
        // Update active session to real one (only if we switched to it)
        if (!skipSwitch) {
          setActiveSession(parsedSession)
        }
        
        return parsedSession
      } else {
        // Remove optimistic session on failure
        queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.filter(s => s.id !== tempId)
        })
        if (!skipSwitch) {
          setActiveSession(null)
        }
        console.error('Failed to create session')
        return null
      }
    } catch (error) {
      // Remove optimistic session on error
      queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
        if (!oldData) return []
        return oldData.filter(s => s.id !== tempId)
      })
      if (!skipSwitch) {
        setActiveSession(null)
      }
      console.error('Error creating session:', error)
      return null
    }
  }

  const handleSessionSwitch = (sessionId: string) => {
    const targetSession = sessions.find(s => s.id === sessionId)
    if (targetSession) {
      setActiveSession(targetSession)
      setGenerationType(targetSession.type)
    }
  }

  const handleGenerationTypeChange = (type: 'image' | 'video') => {
    setGenerationType(type)
    setSurfaceMode(type)
    const sessionsOfType = sessions.filter((s) => s.type === type)
    
    // Try to restore the last active session for this type
    const lastSessionId = lastActiveSessionByTypeRef.current[type]
    if (lastSessionId) {
      const lastSession = sessionsOfType.find(s => s.id === lastSessionId)
      if (lastSession) {
        setActiveSession(lastSession)
        return
      }
    }
    
    // Fall back to first session of this type (sorted by updatedAt)
    setActiveSession(sessionsOfType[0] || null)
  }

  const handleSurfaceModeChange = (mode: 'image' | 'video' | 'editor') => {
    setSurfaceMode(mode)
    if (mode !== 'editor') {
      handleGenerationTypeChange(mode)
    }
  }

  const handleSessionRename = async (session: Session, newName: string) => {
    if (!newName || newName === session.name) return

    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })

      if (response.ok) {
        // Update cache
        queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.map(s => s.id === session.id ? { ...s, name: newName } : s)
        })
        // Update active session if it's the renamed one
        if (activeSession?.id === session.id) {
          setActiveSession({ ...activeSession, name: newName })
        }
        
        toast({
          title: 'Session renamed',
          description: `Session renamed to "${newName}"`,
        })
      }
    } catch (error) {
      console.error('Error renaming session:', error)
      toast({
        title: 'Rename failed',
        description: 'Failed to rename session',
        variant: 'destructive',
      })
    }
  }

  const handleSessionDelete = async (session: Session) => {
    if (!window.confirm(`Delete "${session.name}"? This will delete all generations in this session.`)) {
      return
    }

    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Remove from sessions cache
        queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.filter(s => s.id !== session.id)
        })
        // Invalidate projects cache so session count updates on home page
        queryClient.invalidateQueries({ queryKey: ['projects'] })
        // If deleted session was active, switch to another
        if (activeSession?.id === session.id) {
          const remainingSessions = sessions.filter(s => s.id !== session.id && s.type === generationType)
          if (remainingSessions.length > 0) {
            setActiveSession(remainingSessions[0])
          } else {
            setActiveSession(null)
          }
        }
      }
    } catch (error) {
      console.error('Error deleting session:', error)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Compact Centered Navbar */}
      <Navbar
        theme={theme}
        projectId={projectId}
      />

      {/* Utility Icons - Fixed Top Right */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1">
        <GeminiRateLimitTracker isAdmin={isAdmin} />
        <SpendingTracker isAdmin={isAdmin} />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-8 w-8 transition-transform hover:rotate-12"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
        <Link href="/settings">
          <Button
            variant="ghost"
            size="icon"
            title="Settings"
            className="h-8 w-8"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Project Title - Top Left, aligned with navbar */}
        <div className="fixed left-4 top-4 z-40 flex flex-col gap-0.5">
          {/* Row 1: Title + Privacy Toggle */}
          <div className="flex items-center gap-2 group/title">
            <h1 className="text-sm font-bold truncate max-w-[240px] tracking-tight" title={projectName}>
              {projectName}
            </h1>
            
            {project && project.ownerId === currentUserId && (
              <button
                onClick={handleTogglePrivacy}
                disabled={updating}
                className="bg-muted/50 hover:bg-muted/80 rounded-full p-0.5 flex items-center gap-0 transition-all duration-200 relative scale-90"
                title={
                  project.isShared
                    ? 'Public (visible in Community Creations). Click to make private.'
                    : 'Private (hidden from Community Creations). Click to make public.'
                }
              >
                {/* Lock Icon - Left */}
                <div className={`p-1 rounded-full transition-all z-10 ${
                  !project.isShared 
                    ? 'text-background' 
                    : 'text-muted-foreground/60'
                }`}>
                  <Lock className="h-3 w-3" />
                </div>
                
                {/* Globe Icon - Right */}
                <div className={`p-1 rounded-full transition-all z-10 ${
                  project.isShared 
                    ? 'text-background' 
                    : 'text-muted-foreground/60'
                }`}>
                  <Globe className="h-3 w-3" />
                </div>

                {/* Sliding Background */}
                <div
                  className={`absolute top-0.5 bottom-0.5 w-5 bg-muted-foreground/80 rounded-full transition-all duration-300 ${
                    project.isShared ? 'left-[calc(50%-1px)]' : 'left-0.5'
                  }`}
                />
              </button>
            )}
          </div>
          
          {/* Row 2: Briefing action pill */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenBriefing}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/30 hover:bg-muted/50 border border-border/40 text-[10px] font-semibold text-muted-foreground/80 hover:text-foreground transition-all w-fit uppercase tracking-wider"
              title="Project briefing"
            >
              <FileText className="h-3 w-3" />
              <span>Briefing</span>
            </button>
          </div>
          
          {/* Row 3: Pinned Images with subtle label */}
          {projectId && (
            <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-border/20">
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 font-bold">Pinned</span>
              <PinnedImagesRail
                projectId={projectId}
                onSelectImage={(url) => setPendingPinnedImageUrl(url)}
                className="max-w-[240px]"
              />
            </div>
          )}
        </div>
        
        {/* Floating Session Thumbnails - Vertically centered on left */}
        <div className="fixed left-4 top-1/2 -translate-y-1/2 z-40">
          {sessionsLoading ? (
            <SessionBarSkeleton />
          ) : (
            <FloatingSessionBar
              sessions={sessions}
              activeSession={activeSession}
              generationType={generationType}
              onSessionSelect={(session) => {
                setActiveSession(session)
                if (surfaceMode === 'editor') {
                  setSurfaceMode(session.type)
                  setGenerationType(session.type)
                }
              }}
              onSessionCreate={handleSessionCreate}
              onSessionRename={canManageSessions ? handleSessionRename : undefined}
              onSessionDelete={canManageSessions ? handleSessionDelete : undefined}
            />
          )}
        </div>
        
        {/* Generation Interface - Main Column (shrinks when dock is open) */}
        <GenerationInterface
          session={activeSession}
          generationType={generationType}
          surfaceMode={surfaceMode}
          onSurfaceModeChange={handleSurfaceModeChange}
          projectId={projectId}
          allSessions={sessions}
          onSessionCreate={handleSessionCreate}
          onSessionSwitch={handleSessionSwitch}
          onGenerationTypeChange={handleGenerationTypeChange}
          onToggleChat={() => setIsChatOpen(!isChatOpen)}
          isChatOpen={isChatOpen}
          externalPrompt={externalPrompt}
          onExternalPromptConsumed={() => setExternalPrompt('')}
          externalReferenceImageUrl={pendingPinnedImageUrl}
          onExternalReferenceImageConsumed={() => setPendingPinnedImageUrl(null)}
          deepLinkOutputId={deepLinkOutputId}
          onDeepLinkOutputConsumed={() => setDeepLinkOutputId(null)}
        />
        
        {/* Right Dock Column (Desktop Only, lg+) */}
        <div className={cn(
          "hidden lg:flex flex-col shrink-0 border-l border-border bg-card/50",
          "transition-[width,opacity] duration-300 ease-in-out",
          isChatOpen 
            ? "w-[var(--dock-panel-w)] opacity-100" 
            : "w-0 opacity-0 overflow-hidden"
        )}>
          {isChatOpen && (
            <BrainstormChatWidget 
              variant="docked"
              projectId={projectId}
              isOpen={true}
              onOpenChange={setIsChatOpen}
              onSendPrompt={setExternalPrompt}
            />
          )}
        </div>
      </div>

      {/* Mobile Overlay Fallback (<lg) - Floating variant */}
      <div className="lg:hidden">
        <BrainstormChatWidget 
          variant="floating"
          projectId={projectId}
          isOpen={isChatOpen}
          onOpenChange={setIsChatOpen}
          onSendPrompt={setExternalPrompt}
        />
      </div>

      {/* Briefing Modal */}
      <Dialog open={showBriefingModal} onOpenChange={setShowBriefingModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Project Briefing</DialogTitle>
            <DialogDescription>
              Add high-level instructions or context that will apply to all AI chats in this project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Textarea
              value={briefing}
              onChange={(e) => setBriefing(e.target.value)}
              placeholder="e.g., 'This project focuses on Loop Earplugs marketing campaigns. Generate visuals that emphasize comfort, noise reduction, and modern lifestyle aesthetics.'"
              rows={8}
              className="resize-none"
              disabled={isSavingBriefing}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowBriefingModal(false)}
              disabled={isSavingBriefing}
            >
              Cancel
            </Button>
            <Button
              onClick={saveBriefing}
              disabled={isSavingBriefing}
            >
              {isSavingBriefing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save briefing'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
