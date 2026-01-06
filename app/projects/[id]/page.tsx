'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Settings, Sun, Moon } from 'lucide-react'
import { FloatingSessionBar } from '@/components/sessions/FloatingSessionBar'
import { GenerationInterface } from '@/components/generation/GenerationInterface'
import { useSessions } from '@/hooks/useSessions'
import { Navbar } from '@/components/navbar/Navbar'
import { SpendingTracker } from '@/components/navbar/SpendingTracker'
import type { Session } from '@/types/project'

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const [projectName, setProjectName] = useState('Loading...')
  const [projectOwnerId, setProjectOwnerId] = useState<string>('')
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [generationType, setGenerationType] = useState<'image' | 'video'>('image')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const supabase = createClient()
  const queryClient = useQueryClient()

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

  // Set active session when sessions data loads
  useEffect(() => {
    if (!sessionsLoading && sessions.length > 0) {
      if (!activeSession) {
        // Set first session as active
        setActiveSession(sessions[0])
        setGenerationType(sessions[0].type)
      } else {
        // Preserve active session if it still exists
        const updatedActiveSession = sessions.find(s => s.id === activeSession.id)
        if (updatedActiveSession) {
          setActiveSession(updatedActiveSession)
        }
      }
    } else if (!sessionsLoading && sessions.length === 0) {
      // No sessions - create default
      handleSessionCreate('image')
    }
  }, [sessions, sessionsLoading])

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
        const project = await response.json()
        setProjectName(project.name)
        setProjectOwnerId(project.ownerId)
      }
    } catch (error) {
      console.error('Error fetching project:', error)
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
    // Find sessions of the target type
    const sessionsOfType = sessions.filter(s => s.type === type)
    
    if (sessionsOfType.length > 0) {
      // Switch to the first session of that type
      setActiveSession(sessionsOfType[0])
      setGenerationType(type)
    } else {
      // No sessions of this type exist, create one
      handleSessionCreate(type)
    }
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
        // Remove from cache
        queryClient.setQueryData(['sessions', params.id], (oldData: Session[] | undefined) => {
          if (!oldData) return []
          return oldData.filter(s => s.id !== session.id)
        })
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
      <div className="flex-1 flex overflow-hidden relative pt-16">
        {/* Project Title - Subtle, positioned above session bar */}
        <div className="fixed left-4 top-[72px] z-40 px-2">
          <h1 className="text-xs font-medium text-muted-foreground/80 truncate max-w-[180px] hover:text-muted-foreground transition-colors" title={projectName}>
            {projectName}
          </h1>
        </div>
        
        {/* Floating Session Thumbnails - Left Side (keeps its own fixed positioning) */}
        <FloatingSessionBar
          sessions={sessions}
          activeSession={activeSession}
          generationType={generationType}
          onSessionSelect={setActiveSession}
          onSessionCreate={handleSessionCreate}
          onSessionRename={handleSessionRename}
          onSessionDelete={handleSessionDelete}
        />

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

