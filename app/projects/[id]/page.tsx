'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Settings, Sun, Moon, Lock, Globe } from 'lucide-react'
import { FloatingSessionBar } from '@/components/sessions/FloatingSessionBar'
import { GenerationInterface } from '@/components/generation/GenerationInterface'
import { useSessions } from '@/hooks/useSessions'
import { Navbar } from '@/components/navbar/Navbar'
import { SpendingTracker } from '@/components/navbar/SpendingTracker'
import { useToast } from '@/components/ui/use-toast'
import type { Session, Project } from '@/types/project'

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [projectName, setProjectName] = useState('Loading...')
  const [projectOwnerId, setProjectOwnerId] = useState<string>('')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [generationType, setGenerationType] = useState<'image' | 'video'>('image')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const supabase = createClient()
  const queryClient = useQueryClient()
  const hasProcessedInitialSessionsRef = useRef(false)

  // Use React Query for sessions with intelligent caching
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions(params.id as string)

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
    }
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  useEffect(() => {
    fetchProject()
  }, [params.id])

  // Set active session when sessions data loads (do NOT auto-create sessions)
  useEffect(() => {
    if (sessionsLoading) return

    const isFirstProcess = !hasProcessedInitialSessionsRef.current
    if (isFirstProcess) {
      hasProcessedInitialSessionsRef.current = true
    }

    const urlSessionId =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('sessionId')
        : null
    const firstSessionOfType = sessions.find((s) => s.type === generationType)

    if (sessions.length === 0) {
      if (activeSession) setActiveSession(null)
      return
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
  }, [sessionsLoading, sessions, activeSession, generationType])

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
      const response = await fetch(`/api/projects/${params.id}`)
      if (response.ok) {
        const projectData = await response.json()
        setProject(projectData)
        setProjectName(projectData.name)
        setProjectOwnerId(projectData.ownerId)
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

  const handleSessionCreate = async (type: 'image' | 'video', name?: string): Promise<Session | null> => {
    const projectId = params.id as string
    const sessionName = name || `${type === 'image' ? 'Image' : 'Video'} Session ${sessions.length + 1}`
    
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
    
    // Optimistic update: immediately add to cache and set as active
    queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
      if (!oldData) return [optimisticSession]
      return [...oldData, optimisticSession]
    })
    setActiveSession(optimisticSession)
    setGenerationType(type)
    
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
        
        // Update active session to real one
        setActiveSession(parsedSession)
        
        return parsedSession
      } else {
        // Remove optimistic session on failure
        queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.filter(s => s.id !== tempId)
        })
        setActiveSession(null)
        console.error('Failed to create session')
        return null
      }
    } catch (error) {
      // Remove optimistic session on error
      queryClient.setQueryData(['sessions', projectId], (oldData: Session[] | undefined) => {
        if (!oldData) return []
        return oldData.filter(s => s.id !== tempId)
      })
      setActiveSession(null)
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
    const sessionsOfType = sessions.filter((s) => s.type === type)
    setActiveSession(sessionsOfType[0] || null)
  }

  const handleSessionRename = async (session: Session) => {
    const newName = window.prompt('Enter new session name:', session.name)
    if (!newName || newName === session.name) return

    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })

      if (response.ok) {
        // Update cache
        queryClient.setQueryData(['sessions', params.id], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.map(s => s.id === session.id ? { ...s, name: newName } : s)
        })
        // Update active session if it's the renamed one
        if (activeSession?.id === session.id) {
          setActiveSession({ ...activeSession, name: newName })
        }
      }
    } catch (error) {
      console.error('Error renaming session:', error)
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
        queryClient.setQueryData(['sessions', params.id], (oldData: Session[] | undefined) => {
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
      {/* Compact Centered Navbar - Logo + Image/Video Toggle */}
      <Navbar
        theme={theme}
        generationType={generationType}
        onGenerationTypeChange={handleGenerationTypeChange}
        showGenerationToggle={true}
      />

      {/* Utility Icons - Fixed Top Right */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1">
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
        {/* Project Header Frame - Left Side */}
        <div className="fixed left-4 top-20 z-40 flex flex-col gap-4 pointer-events-none">
          {/* Title Frame */}
          <div className="bg-background/95 backdrop-blur-md border border-border px-4 py-2 rounded-2xl shadow-xl flex items-center gap-3 pointer-events-auto min-w-[180px] max-w-[320px] ring-1 ring-black/5 dark:ring-white/5">
            <h1 className="text-sm font-bold truncate flex-1 tracking-tight" title={projectName}>
              {projectName}
            </h1>
            
            <div className="w-px h-4 bg-border/60" />
            
            {project && project.ownerId === currentUserId && (
              <button
                onClick={handleTogglePrivacy}
                disabled={updating}
                className="flex items-center gap-1 p-1.5 hover:bg-muted rounded-lg transition-all text-muted-foreground hover:text-foreground"
                title={project.isShared ? 'Shared - Click to make private' : 'Private - Click to enable sharing'}
              >
                {project.isShared ? (
                  <Globe className="h-4 w-4 text-primary animate-in zoom-in duration-300" />
                ) : (
                  <Lock className="h-4 w-4 animate-in zoom-in duration-300" />
                )}
              </button>
            )}
          </div>
          
          {/* Floating Session Thumbnails */}
          <div className="pointer-events-auto">
            <FloatingSessionBar
              sessions={sessions}
              activeSession={activeSession}
              generationType={generationType}
              onSessionSelect={setActiveSession}
              onSessionCreate={handleSessionCreate}
              onSessionRename={handleSessionRename}
              onSessionDelete={handleSessionDelete}
            />
          </div>
        </div>
        
        {/* Generation Interface - Full Width */}
        <GenerationInterface
          session={activeSession}
          generationType={generationType}
          allSessions={sessions}
          onSessionCreate={handleSessionCreate}
          onSessionSwitch={handleSessionSwitch}
        />
      </div>

    </div>
  )
}

