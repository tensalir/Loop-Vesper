'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useProfile } from '@/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Plus,
  ShieldAlert,
  Globe,
  ExternalLink,
  Link2,
  Unlink,
  Search,
} from 'lucide-react'

interface BrandWorldProject {
  id: string
  name: string
  description: string | null
  updatedAt: string
  owner: { id: string; displayName: string | null; username: string | null }
  sessions: { id: string; name: string; type: string }[]
  brandWorldSettings: { source: string; createdAt: string } | null
}

function useBrandWorldProjects(mode: 'linked' | 'all') {
  return useQuery<BrandWorldProject[]>({
    queryKey: ['brand-world-projects', mode],
    queryFn: async () => {
      const res = await fetch(`/api/brand-world/projects?mode=${mode}`)
      if (!res.ok) throw new Error('Failed to fetch projects')
      return res.json()
    },
    staleTime: 30_000,
  })
}

export default function BrandWorldLibraryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: profile, isLoading: profileLoading } = useProfile()
  const isAdmin = profile?.role === 'admin'

  const [activeTab, setActiveTab] = useState('linked')
  const [showCreate, setShowCreate] = useState(false)
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const { data: linkedProjects, isLoading: linkedLoading } = useBrandWorldProjects('linked')
  const { data: allProjects, isLoading: allLoading } = useBrandWorldProjects('all')

  const invalidateBoth = () => {
    queryClient.invalidateQueries({ queryKey: ['brand-world-projects'] })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || null }),
      })
      if (!res.ok) throw new Error('Failed to create project')
      const project = await res.json()

      await fetch(`/api/brand-world/projects/${project.id}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'created' }),
      })

      return project
    },
    onSuccess: (project: { id: string }) => {
      invalidateBoth()
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setShowCreate(false)
      setNewName('')
      setNewDescription('')
      router.push(`/brand-world/${project.id}`)
    },
  })

  const linkMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/brand-world/projects/${projectId}/link`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to link project')
      return res.json()
    },
    onSuccess: () => {
      invalidateBoth()
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/brand-world/projects/${projectId}/unlink`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to unlink project')
      return res.json()
    },
    onSuccess: () => {
      invalidateBoth()
    },
  })

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-4">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-1">Admin access required</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Brand World is currently available to admin users only.
          </p>
        </div>
        <button onClick={() => router.push('/')} className="text-sm text-primary hover:underline">
          Back to dashboard
        </button>
      </div>
    )
  }

  const filteredAllProjects = allProjects?.filter(
    (p) => !linkSearch || p.name.toLowerCase().includes(linkSearch.toLowerCase())
  )

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Brand World</h1>
          <p className="text-muted-foreground">
            Interactive festival worlds for AI-generated content
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowLinkSearch(true)}>
            <Link2 className="mr-2 h-4 w-4" />
            Link existing project
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="linked">
            Brand World Projects
            {linkedProjects && linkedProjects.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-primary/10 text-primary rounded-full px-1.5 py-0.5 leading-none font-medium">
                {linkedProjects.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All Projects</TabsTrigger>
        </TabsList>

        <TabsContent value="linked" className="mt-4">
          {linkedLoading ? (
            <LoadingState />
          ) : !linkedProjects || linkedProjects.length === 0 ? (
            <EmptyLinkedState
              onCreateNew={() => setShowCreate(true)}
              onLinkExisting={() => setShowLinkSearch(true)}
            />
          ) : (
            <ProjectGrid
              projects={linkedProjects}
              onCardClick={(id) => router.push(`/brand-world/${id}`)}
              onOpenProject={(id) => router.push(`/projects/${id}`)}
              onUnlink={(id) => unlinkMutation.mutate(id)}
              unlinkingId={unlinkMutation.isPending ? (unlinkMutation.variables as string) : null}
              showBadges
            />
          )}
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <div className="mb-4">
            <div className="relative max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter projects…"
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          {allLoading ? (
            <LoadingState />
          ) : !filteredAllProjects || filteredAllProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No projects found.</p>
          ) : (
            <ProjectGrid
              projects={filteredAllProjects}
              onCardClick={(id) => router.push(`/brand-world/${id}`)}
              onOpenProject={(id) => router.push(`/projects/${id}`)}
              onLink={(id) => linkMutation.mutate(id)}
              onUnlink={(id) => unlinkMutation.mutate(id)}
              linkingId={linkMutation.isPending ? (linkMutation.variables as string) : null}
              unlinkingId={unlinkMutation.isPending ? (unlinkMutation.variables as string) : null}
              showBadges
              showLinkActions
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Create new project dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create Brand World Project</DialogTitle>
            <DialogDescription>
              Set up a new project for your interactive festival world. Zone sessions will be created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Summer Festival 2026"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description (optional)</label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Brief description of this world"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating&hellip;</>
              ) : (
                'Create project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link existing project dialog */}
      <LinkProjectDialog
        open={showLinkSearch}
        onOpenChange={setShowLinkSearch}
        projects={allProjects}
        isLoading={allLoading}
        onLink={(id) => {
          linkMutation.mutate(id, {
            onSuccess: () => setShowLinkSearch(false),
          })
        }}
        linkingId={linkMutation.isPending ? (linkMutation.variables as string) : null}
      />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function EmptyLinkedState({
  onCreateNew,
  onLinkExisting,
}: {
  onCreateNew: () => void
  onLinkExisting: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="rounded-full bg-muted p-4">
        <Globe className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-1">No Brand World projects yet</h2>
        <p className="text-muted-foreground max-w-md">
          Create a new project or link an existing one to start placing AI-generated content in an interactive festival environment.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onLinkExisting}>
          <Link2 className="mr-2 h-4 w-4" />
          Link existing project
        </Button>
        <Button onClick={onCreateNew}>
          <Plus className="mr-2 h-4 w-4" />
          Create new project
        </Button>
      </div>
    </div>
  )
}

function ProjectGrid({
  projects,
  onCardClick,
  onOpenProject,
  onLink,
  onUnlink,
  linkingId,
  unlinkingId,
  showBadges,
  showLinkActions,
}: {
  projects: BrandWorldProject[]
  onCardClick: (id: string) => void
  onOpenProject: (id: string) => void
  onLink?: (id: string) => void
  onUnlink?: (id: string) => void
  linkingId?: string | null
  unlinkingId?: string | null
  showBadges?: boolean
  showLinkActions?: boolean
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((project) => {
        const isLinked = !!project.brandWorldSettings
        const source = project.brandWorldSettings?.source
        return (
          <div
            key={project.id}
            className="group relative border border-border/60 rounded-lg p-5 hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer"
            onClick={() => onCardClick(project.id)}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Globe className="h-4 w-4 text-primary" />
              </div>
              <div className="flex items-center gap-1">
                {showLinkActions && (
                  isLinked ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={unlinkingId === project.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onUnlink?.(project.id)
                      }}
                      title="Unlink from Brand World"
                    >
                      {unlinkingId === project.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={linkingId === project.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onLink?.(project.id)
                      }}
                      title="Link to Brand World"
                    >
                      {linkingId === project.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  )
                )}
                {!showLinkActions && onUnlink && isLinked && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    disabled={unlinkingId === project.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnlink(project.id)
                    }}
                    title="Unlink from Brand World"
                  >
                    {unlinkingId === project.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenProject(project.id)
                  }}
                  title="Open in project workspace"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            </div>
            <h3 className="font-semibold text-sm mb-1 truncate">{project.name}</h3>
            {project.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="uppercase tracking-wider">
                {new Date(project.updatedAt).toLocaleDateString()}
              </span>
              {showBadges && isLinked && (
                <Badge
                  variant={source === 'created' ? 'default' : 'secondary'}
                  className="text-[9px] px-1.5 py-0"
                >
                  {source === 'created' ? 'Created here' : 'Linked'}
                </Badge>
              )}
              {showBadges && !isLinked && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                  Not linked
                </Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LinkProjectDialog({
  open,
  onOpenChange,
  projects,
  isLoading,
  onLink,
  linkingId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: BrandWorldProject[] | undefined
  isLoading: boolean
  onLink: (id: string) => void
  linkingId: string | null
}) {
  const [search, setSearch] = useState('')

  const unlinkableProjects = projects?.filter(
    (p) => !p.brandWorldSettings && p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Link existing project</DialogTitle>
          <DialogDescription>
            Choose a project to add to Brand World. Its existing content won&apos;t be affected.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1 py-1">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !unlinkableProjects || unlinkableProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {search ? 'No unlinked projects match your search.' : 'All projects are already linked.'}
            </p>
          ) : (
            unlinkableProjects.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.description && (
                    <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={linkingId === p.id}
                  onClick={() => onLink(p.id)}
                  className="shrink-0 ml-3"
                >
                  {linkingId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Link2 className="mr-1.5 h-3.5 w-3.5" />
                      Link
                    </>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
