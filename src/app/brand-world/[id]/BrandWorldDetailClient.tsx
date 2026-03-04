'use client'

import { useEffect, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ExternalLink, Loader2, Link2 } from 'lucide-react'
import { STAGES } from '@/lib/brand-world/world-config'
import { bootstrapZoneSessions } from '@/lib/brand-world/zone-sessions'

const BrandWorldViewport = dynamic(
  () => import('@/components/brand-world/BrandWorldViewport').then((m) => m.BrandWorldViewport),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading world&hellip;</p>
        </div>
      </div>
    ),
  }
)

interface SessionInfo {
  id: string
  name: string
  type: string
}

interface BrandWorldDetailClientProps {
  projectId: string
  projectName: string
  projectDescription: string | null
  initialSessions: SessionInfo[]
  isLinked: boolean
  linkSource: string | null
}

export function BrandWorldDetailClient({
  projectId,
  projectName,
  initialSessions,
  isLinked: initialLinked,
}: BrandWorldDetailClientProps) {
  const router = useRouter()
  const [bootstrapping, setBootstrapping] = useState(false)
  const [linked, setLinked] = useState(initialLinked)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (!linked) return
    let cancelled = false
    async function ensureSessions() {
      const needed = bootstrapZoneSessions.getMissing(STAGES, initialSessions)
      if (needed.length === 0) return

      setBootstrapping(true)
      try {
        await bootstrapZoneSessions.createMissing(projectId, needed)
      } catch (err) {
        console.error('Failed to bootstrap zone sessions:', err)
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    ensureSessions()
    return () => { cancelled = true }
  }, [projectId, initialSessions, linked])

  const handleLink = useCallback(async () => {
    setLinking(true)
    try {
      const res = await fetch(`/api/brand-world/projects/${projectId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'linked' }),
      })
      if (res.ok) {
        setLinked(true)
      }
    } catch (err) {
      console.error('Failed to link project:', err)
    } finally {
      setLinking(false)
    }
  }, [projectId])

  const handleOpenProject = useCallback(() => {
    router.push(`/projects/${projectId}`)
  }, [router, projectId])

  if (!linked) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <div className="flex items-center px-4 h-12 border-b border-border/50 bg-card/30 backdrop-blur-sm shrink-0 z-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 mr-3"
            onClick={() => router.push('/brand-world')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-bold truncate max-w-[240px]">{projectName}</h1>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="rounded-full bg-muted p-4">
            <Link2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center max-w-sm">
            <h2 className="text-xl font-semibold mb-1">Not linked to Brand World</h2>
            <p className="text-sm text-muted-foreground">
              This project hasn&apos;t been linked to Brand World yet.
              Link it to start placing AI-generated content in an interactive festival environment.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/brand-world')}>
              Back to overview
            </Button>
            <Button onClick={handleLink} disabled={linking}>
              {linking ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking&hellip;</>
              ) : (
                <><Link2 className="mr-2 h-4 w-4" />Link to Brand World</>
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-4 h-12 border-b border-border/50 bg-card/30 backdrop-blur-sm shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => router.push('/brand-world')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-bold truncate max-w-[240px]">{projectName}</h1>
          {bootstrapping && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Setting up zones&hellip;
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleOpenProject}
          >
            <ExternalLink className="h-3 w-3" />
            Open project
          </Button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <BrandWorldViewport
          projectId={projectId}
          projectName={projectName}
        />
      </div>
    </div>
  )
}
