'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Plus, LogOut, Settings, Sun, Moon, Check, ExternalLink, Download } from 'lucide-react'
import { SpendingTracker } from '@/components/navbar/SpendingTracker'
import { Navbar } from '@/components/navbar/Navbar'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import { NewProjectDialog } from '@/components/projects/NewProjectDialog'
import { useProjects } from '@/hooks/useProjects'
import { useApprovedOutputs } from '@/hooks/useApprovedOutputs'
import { useToast } from '@/components/ui/use-toast'
import type { Project } from '@/types/project'

type TabType = 'briefings' | 'projects' | 'review'

// Review Tab Component
function ReviewTabContent() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: approvedOutputs = [], isLoading, refetch } = useApprovedOutputs()
  const queryClient = useQueryClient()

  const handleOpenSession = (projectId: string, sessionId: string) => {
    router.push(`/projects/${projectId}?sessionId=${sessionId}`)
  }

  const handleUnapprove = async (outputId: string) => {
    try {
      const response = await fetch(`/api/outputs/${outputId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isApproved: false }),
      })

      if (!response.ok) throw new Error('Failed to unapprove')

      toast({
        title: 'Unapproved',
        description: 'Item removed from review',
        variant: 'default',
      })

      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['approvedOutputs'] })
      // Also invalidate generations queries to update checkmark state
      queryClient.invalidateQueries({ queryKey: ['generations'] })
      refetch()
    } catch (error) {
      console.error('Error unapproving:', error)
      toast({
        title: 'Error',
        description: 'Failed to unapprove item',
        variant: 'destructive',
      })
    }
  }

  const handleDownload = async (fileUrl: string, outputId: string, fileType: string = 'image') => {
    try {
      const response = await fetch(fileUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const extension = fileType === 'video' ? 'mp4' : 'png'
      link.download = `approved-${outputId}.${extension}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
      toast({
        title: 'Download failed',
        description: `Failed to download ${fileType}`,
        variant: 'destructive',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading approved items...</p>
      </div>
    )
  }

  if (approvedOutputs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">No approved items yet</h2>
          <p className="text-muted-foreground">
            Click the checkmark icon on any generation to approve it for review. Approved items will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Review</h2>
          <p className="text-muted-foreground">
            {approvedOutputs.length} {approvedOutputs.length === 1 ? 'item' : 'items'} approved for review
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {approvedOutputs.map((output) => (
          <div
            key={output.id}
            className="group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-200 hover:border-primary/50"
          >
            {/* Media */}
            <div
              className="aspect-square relative cursor-pointer bg-muted"
              onClick={() =>
                handleOpenSession(
                  output.generation.session.project.id,
                  output.generation.session.id
                )
              }
            >
              {output.fileType === 'image' ? (
                <Image
                  src={output.fileUrl}
                  alt={output.generation.prompt}
                  fill
                  className="object-cover"
                  loading="lazy"
                  unoptimized={false}
                />
              ) : (
                <video
                  src={output.fileUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
              )}

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <p className="text-white text-sm font-medium px-4">
                    Open in {output.generation.session.name}
                  </p>
                  <ExternalLink className="h-5 w-5 text-white mx-auto" />
                </div>
              </div>

              {/* Approved Badge */}
              <div className="absolute top-2 left-2 px-2 py-1 bg-primary backdrop-blur-sm rounded-lg flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-black" />
                <span className="text-xs font-medium text-black">Approved</span>
              </div>
            </div>

            {/* Info */}
            <div className="p-4 space-y-3">
              {/* Prompt */}
              <p className="text-sm font-medium line-clamp-2 text-foreground">
                {output.generation.prompt}
              </p>

              {/* Metadata */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {output.generation.session.project.name}
                  </span>
                  <span className="text-muted-foreground/70">
                    {new Date(output.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {output.generation.session.name}
                  </span>
                  <span className="text-muted-foreground/70 capitalize">
                    {output.generation.modelId.replace('gemini-', '').replace('fal-', '').replace('-', ' ')}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenSession(
                      output.generation.session.project.id,
                      output.generation.session.id
                    )
                  }}
                  className="flex-1 h-8 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(output.fileUrl, output.id, output.fileType)
                  }}
                  className="h-8 px-2"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleUnapprove(output.id)
                  }}
                  className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  title="Unapprove"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectsPageContent() {
  const [showNewProject, setShowNewProject] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('projects')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Use React Query for projects with caching
  const { data: projects = [], isLoading: loading, refetch } = useProjects()

  // Read tab from URL query params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'review' || tab === 'briefings' || tab === 'projects') {
      setActiveTab(tab)
    }
  }, [searchParams])

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
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header Section - Clean background for navbar */}
      <header className="h-20 flex items-center justify-between px-6 relative z-50">
        {/* Navbar + New Button - Centered */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <Navbar theme={theme} showGenerationToggle={false} standalone={false} />
          <Button
            onClick={() => setShowNewProject(true)}
            className="h-12 px-4 rounded-lg shadow-sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Spacer for left side */}
        <div />

        {/* Utility Icons - Right */}
        <div className="flex items-center gap-1">
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
            <Button variant="ghost" size="icon" title="Settings" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </Link>
          <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out" className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Content Frame - Full width with background */}
      <main className="flex-1 relative">
        {/* Content Frame with rounded top corners */}
        <div
          className="absolute inset-0 rounded-t-3xl overflow-hidden border-t border-x border-border bg-cover bg-center bg-no-repeat"
          style={{ 
            backgroundImage: `url('/images/Full page_Sketch${theme === 'light' ? ' (Light)' : ''}.png')` 
          }}
        >
          {/* Tab Navigation - Protruding at top of frame */}
          <div className="pt-6 pb-6 flex justify-center">
            <div className="inline-flex items-center gap-1 p-1.5 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-lg">
              <button
                onClick={() => setActiveTab('briefings')}
                className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all uppercase tracking-wide ${
                  activeTab === 'briefings'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Briefings
              </button>
              <button
                onClick={() => setActiveTab('projects')}
                className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all uppercase tracking-wide ${
                  activeTab === 'projects'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Projects
              </button>
              <button
                onClick={() => setActiveTab('review')}
                className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all uppercase tracking-wide ${
                  activeTab === 'review'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                Review
              </button>
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div className="h-[calc(100%-88px)] overflow-y-auto">
            <div className="container mx-auto px-6 pb-8">
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
              {activeTab === 'review' && <ReviewTabContent />}
            </div>
          </div>
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

// Wrap in Suspense for useSearchParams() - required by Next.js 14
export default function ProjectsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <ProjectsPageContent />
    </Suspense>
  )
}
