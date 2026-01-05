'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Plus, LogOut, Settings, Sun, Moon, Bookmark } from 'lucide-react'
import { SpendingTracker } from '@/components/navbar/SpendingTracker'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { useProjects } from '@/hooks/useProjects'
import type { Project } from '@/types/project'

type TabType = 'briefings' | 'projects' | 'review'

export default function ProjectsPage() {
  const [showNewProject, setShowNewProject] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('projects')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Use React Query for projects with caching
  const { data: projects = [], isLoading: loading, refetch } = useProjects()

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

  // Initialize user and admin check
  useEffect(() => {
    const initUser = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError || !user) {
        router.push('/login')
        return
      }

      setCurrentUserId(user.id)

      // Fetch user profile to check admin status
      const profileResponse = await fetch('/api/profile')
      if (profileResponse.ok) {
        const profile = await profileResponse.json()
        setIsAdmin(profile.role === 'admin')
      }
    }

    initUser()
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleProjectCreated = (project: Project) => {
    // Optimistic update: immediately add the new project to the cache
    queryClient.setQueryData(['projects'], (oldData: (Project & { thumbnailUrl?: string | null })[] | undefined) => {
      if (!oldData) return [project]
      // Add new project at the beginning of the list
      return [{ ...project, thumbnailUrl: null }, ...oldData]
    })
    setShowNewProject(false)
    
    // Also invalidate to ensure data consistency (will update in background)
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  const handleProjectUpdate = () => {
    // Invalidate and refetch projects query
    queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={theme === 'light' ? "/images/Loop Vesper (Black).svg" : "/images/Loop Vesper (White).svg"}
              alt="Loop Vesper Logo" 
              className="h-8 object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowNewProject(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => router.push('/bookmarks')}
              title="Bookmarks"
            >
              <Bookmark className="h-4 w-4" />
            </Button>
            <SpendingTracker isAdmin={isAdmin} />
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleTheme}
              className="transition-transform hover:rotate-12"
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
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-border bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-12">
            <button
              onClick={() => setActiveTab('briefings')}
              className={`px-6 py-4 text-lg font-bold transition-all relative uppercase ${
                activeTab === 'briefings'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontFamily: 'Avantt, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 700 }}
            >
              Briefings
              {activeTab === 'briefings' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`px-6 py-4 text-lg font-bold transition-all relative uppercase ${
                activeTab === 'projects'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontFamily: 'Avantt, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 700 }}
            >
              Projects
              {activeTab === 'projects' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('review')}
              className={`px-6 py-4 text-lg font-bold transition-all relative uppercase ${
                activeTab === 'review'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={{ fontFamily: 'Avantt, -apple-system, BlinkMacSystemFont, sans-serif', fontWeight: 700 }}
            >
              Review
              {activeTab === 'review' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>
        </div>
      </div>

            {/* Main Content */}
            <main
              className="w-full min-h-screen bg-cover bg-center bg-no-repeat"
              style={{ 
                backgroundImage: `url('/images/Full page_Sketch${theme === 'light' ? ' (Light)' : ''}.png')` 
              }}
            >
              <div className="container mx-auto px-4 py-8">
                {/* Briefings Tab */}
                {activeTab === 'briefings' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-primary"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" x2="8" y1="13" y2="13" />
                  <line x1="16" x2="8" y1="17" y2="17" />
                  <line x1="10" x2="8" y1="9" y2="9" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold">Briefings</h2>
              <p className="text-muted-foreground">
                Create and manage creative briefings for your team. This feature is coming soon.
              </p>
            </div>
          </div>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-muted-foreground">Loading projects...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="text-center">
                  <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
                  <p className="text-muted-foreground mb-6">
                    Create your first project to start generating AI content
                  </p>
                  <Button onClick={() => setShowNewProject(true)} size="lg">
                    <Plus className="mr-2 h-5 w-5" />
                    Create Your First Project
                  </Button>
                </div>
              </div>
            ) : (
              <ProjectGrid 
                projects={projects} 
                currentUserId={currentUserId || undefined}
                onProjectUpdate={handleProjectUpdate}
              />
            )}
          </>
        )}

        {/* Review Tab */}
        {activeTab === 'review' && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-green-600"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold">Review</h2>
              <p className="text-muted-foreground">
                Review and approve content submitted by your team. Approved items will appear here.
              </p>
                  </div>
                </div>
              )}
              </div>
            </main>

            {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onProjectCreated={handleProjectCreated}
      />

    </div>
  )
}
