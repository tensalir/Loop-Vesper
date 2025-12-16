'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Settings, Sun, Moon, Bookmark } from 'lucide-react'
import { SessionSidebar } from '@/components/sessions/SessionSidebar'
import { GenerationInterface } from '@/components/generation/GenerationInterface'
import { useSessions } from '@/hooks/useSessions'
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
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: params.id as string,
          name: name || `${type === 'image' ? 'Image' : 'Video'} Session ${sessions.length + 1}`,
          type,
        }),
      })

      if (response.ok) {
        const newSession = await response.json()
        // Parse dates from strings to Date objects
        const parsedSession = {
          ...newSession,
          createdAt: new Date(newSession.createdAt),
          updatedAt: new Date(newSession.updatedAt),
        }
        setActiveSession(parsedSession)
        setGenerationType(type)
        // Sessions will refetch automatically via React Query
        return parsedSession
      } else {
        console.error('Failed to create session')
        return null
      }
    } catch (error) {
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

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left side - Logo + Project Info */}
          <div className="flex items-center gap-3 flex-1">
            <img 
              src={theme === 'light' ? "/images/Loop Vesper (Black).svg" : "/images/Loop Vesper (White).svg"}
              alt="Loop Vesper Logo" 
              className="h-7 object-contain cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => router.push('/projects')}
              title="Back to Projects"
            />
            <div className="border-l border-border pl-3">
              <h1 className="font-semibold">{projectName}</h1>
            </div>
          </div>

          {/* Center - Mode Toggle with Icons */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button
              variant={generationType === 'image' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleGenerationTypeChange('image')}
              className="h-8 w-8 p-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </Button>
            <Button
              variant={generationType === 'video' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleGenerationTypeChange('video')}
              className="h-8 w-8 p-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
                <rect x="2" y="6" width="14" height="12" rx="2" />
              </svg>
            </Button>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            <SpendingTracker isAdmin={isAdmin} />
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => router.push('/bookmarks')}
              title="Bookmarks"
            >
              <Bookmark className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleTheme}
              className="transition-transform hover:rotate-12"
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
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sessions Sidebar - Always Visible */}
        <SessionSidebar
          sessions={sessions.filter(s => s.type === generationType)}
          activeSession={activeSession}
          generationType={generationType}
          projectOwnerId={projectOwnerId}
          currentUserId={currentUserId}
          onSessionSelect={setActiveSession}
          onSessionCreate={handleSessionCreate}
          onSessionUpdate={() => {}}
        />

        {/* Generation Interface */}
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

