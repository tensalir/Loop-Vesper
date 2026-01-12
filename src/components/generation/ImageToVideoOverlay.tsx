'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Video, Plus, Play, Loader2, Check, Clock, AlertCircle, ChevronDown, ChevronUp, RotateCcw, Download, Bookmark, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VideoInput } from './VideoInput'
import { useVideoIterations, type VideoIteration, type VideoIterationsResponse } from '@/hooks/useVideoIterations'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { useGenerateMutation } from '@/hooks/useGenerateMutation'
import { useSessions } from '@/hooks/useSessions'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@/types/project'

interface ImageToVideoOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** The source image output ID (used to link generated videos) */
  outputId: string
  /** The source image URL to display and use as reference */
  imageUrl: string
  /** Project ID for session management */
  projectId: string
  /** Callback when a video session is created */
  onCreateSession?: (type: 'video', name: string) => Promise<Session | null>
  /** Callback after successful generation */
  onGenerationStarted?: () => void
}

/**
 * Glass overlay for animating a still image into video.
 * 
 * Features:
 * - Session picker (existing/new video session)
 * - Full VideoInput controls with locked reference image
 * - Iteration history with playable video previews
 * - Smart polling while generations are processing
 */
export function ImageToVideoOverlay({
  isOpen,
  onClose,
  outputId,
  imageUrl,
  projectId,
  onCreateSession,
  onGenerationStarted,
}: ImageToVideoOverlayProps) {
  const queryClient = useQueryClient()
  const generateMutation = useGenerateMutation()
  
  // Session management
  const { data: allSessions = [] } = useSessions(projectId)
  const videoSessions = allSessions.filter((s) => s.type === 'video')
  
  // Session selection state
  const [sessionMode, setSessionMode] = useState<'existing' | 'new'>('existing')
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [newSessionName, setNewSessionName] = useState('')
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  
  // Video generation state
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState('kling-official')
  const [parameters, setParameters] = useState({
    aspectRatio: '16:9',
    resolution: 720,
    numOutputs: 1,
    duration: 5,
  })
  
  // Video iterations for this source image
  const { iterations, count, hasProcessing, latestStatus, refetch } = useVideoIterations(
    isOpen ? outputId : null,
    { limit: 20 }
  )
  
  // Sync stuck generations state
  const { toast } = useToast()
  const [isSyncing, setIsSyncing] = useState(false)
  
  // Sync stuck generations with Replicate
  const handleSyncStuck = useCallback(async () => {
    // Find processing iterations that might be stuck
    const stuckIterations = iterations.filter(iter => iter.status === 'processing')
    
    if (stuckIterations.length === 0) {
      toast({
        title: 'Nothing to sync',
        description: 'No stuck generations found.',
      })
      return
    }
    
    setIsSyncing(true)
    let syncedCount = 0
    let failedCount = 0
    
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session?.access_token) {
        toast({
          title: 'Not authenticated',
          description: 'Please sign in to sync generations.',
          variant: 'destructive',
        })
        return
      }
      
      // Sync each stuck generation
      for (const iter of stuckIterations) {
        try {
          const response = await fetch(`/api/generations/${iter.id}/sync`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
          })
          
          const result = await response.json()
          
          if (result.synced) {
            syncedCount++
          }
        } catch (error) {
          console.error(`Failed to sync ${iter.id}:`, error)
          failedCount++
        }
      }
      
      // Refetch iterations to update UI
      await refetch()
      
      if (syncedCount > 0) {
        toast({
          title: 'Sync complete',
          description: `${syncedCount} generation${syncedCount !== 1 ? 's' : ''} synced successfully.`,
        })
      } else if (failedCount > 0) {
        toast({
          title: 'Sync failed',
          description: 'Could not sync stuck generations. They may still be processing.',
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Still processing',
          description: 'Generations are still being created on the server.',
        })
      }
    } catch (error: any) {
      console.error('Sync error:', error)
      toast({
        title: 'Sync failed',
        description: error.message || 'Failed to sync generations.',
        variant: 'destructive',
      })
    } finally {
      setIsSyncing(false)
    }
  }, [iterations, refetch, toast])
  
  // Auto-select first video session
  useEffect(() => {
    if (videoSessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(videoSessions[0].id)
      setSessionMode('existing')
    } else if (videoSessions.length === 0) {
      setSessionMode('new')
      // Suggest a default name
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      setNewSessionName(`Video – ${dateStr}`)
    }
  }, [videoSessions, selectedSessionId])
  
  // Handle session creation
  const ensureVideoSession = useCallback(async (): Promise<string | null> => {
    if (sessionMode === 'existing' && selectedSessionId) {
      return selectedSessionId
    }
    
    if (sessionMode === 'new' && newSessionName.trim() && onCreateSession) {
      setIsCreatingSession(true)
      try {
        const newSession = await onCreateSession('video', newSessionName.trim())
        if (newSession) {
          setSelectedSessionId(newSession.id)
          setSessionMode('existing')
          return newSession.id
        }
      } catch (error) {
        console.error('Failed to create video session:', error)
      } finally {
        setIsCreatingSession(false)
      }
    }
    
    return null
  }, [sessionMode, selectedSessionId, newSessionName, onCreateSession])
  
  // Handle video generation
  const handleGenerate = useCallback(async (
    promptText: string,
    options?: { 
      referenceImage?: File
      referenceImageId?: string
      endFrameImage?: File
      endFrameImageId?: string
    }
  ) => {
    const sessionId = await ensureVideoSession()
    if (!sessionId) {
      console.error('No video session available')
      return
    }
    
    try {
      // Immediately reflect "processing" on the source image card(s) in the gallery.
      // `useVideoIterations` uses a 30s staleTime to avoid request explosion, so we
      // optimistically set hasProcessing=true and then invalidate to fetch truth.
      queryClient.setQueriesData<VideoIterationsResponse>(
        { queryKey: ['videoIterations', outputId] },
        (old) => {
          if (!old) {
            return {
              iterations: [],
              count: 0,
              hasProcessing: true,
              latestStatus: 'processing',
              sourceOutputId: outputId,
            }
          }
          return {
            ...old,
            hasProcessing: true,
            latestStatus: 'processing',
          }
        }
      )

      // Convert reference image to base64 if provided
      let referenceImageBase64: string | undefined
      if (options?.referenceImage) {
        referenceImageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(options.referenceImage!)
        })
      }
      
      // Convert end frame image to base64 if provided
      let endFrameImageBase64: string | undefined
      if (options?.endFrameImage) {
        endFrameImageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(options.endFrameImage!)
        })
      }
      
      await generateMutation.mutateAsync({
        sessionId,
        modelId: selectedModel,
        prompt: promptText,
        parameters: {
          ...parameters,
          referenceImage: referenceImageBase64,
          referenceImageId: outputId, // Use outputId as reference ID
          sourceOutputId: outputId, // Link to source image
          ...(endFrameImageBase64 && { endFrameImage: endFrameImageBase64 }),
        },
      })
      
      // Refetch iterations to show the new one
      refetch()
      onGenerationStarted?.()
      
      // Invalidate the video session's generations
      queryClient.invalidateQueries({ queryKey: ['generations', sessionId] })
      // Invalidate video iterations for this source output so the gallery glow/stack updates immediately.
      queryClient.invalidateQueries({ queryKey: ['videoIterations', outputId] })
      
      // Keep overlay open so user can see progress and make more iterations
      // Prompt is preserved for easy iteration
    } catch (error) {
      console.error('Video generation failed:', error)
    }
  }, [ensureVideoSession, generateMutation, selectedModel, parameters, outputId, refetch, onGenerationStarted, queryClient])
  
  // Handle bookmark toggle for video outputs
  const handleToggleBookmark = useCallback(async (outputId: string, isBookmarked: boolean) => {
    try {
      const method = isBookmarked ? 'DELETE' : 'POST'
      const response = await fetch('/api/bookmarks', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputId }),
      })
      if (!response.ok) throw new Error('Failed to toggle bookmark')
      // Refetch iterations to update bookmark state
      refetch()
    } catch (error) {
      console.error('Error toggling bookmark:', error)
    }
  }, [refetch])
  
  // Handle approve toggle for video outputs
  const handleToggleApproval = useCallback(async (outputId: string, isApproved: boolean) => {
    try {
      const response = await fetch(`/api/outputs/${outputId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isApproved: !isApproved }),
      })
      if (!response.ok) throw new Error('Failed to toggle approval')
      // Invalidate approved outputs query
      queryClient.invalidateQueries({ queryKey: ['approvedOutputs'] })
      // Refetch iterations to update approval state
      refetch()
    } catch (error) {
      console.error('Error toggling approval:', error)
    }
  }, [queryClient, refetch])
  
  // Handle delete generation (for failed ones)
  const handleDeleteGeneration = useCallback(async (generationId: string) => {
    try {
      const response = await fetch(`/api/generations/${generationId}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete generation')
      // Refetch iterations to remove the deleted one
      refetch()
    } catch (error) {
      console.error('Error deleting generation:', error)
    }
  }, [refetch])
  
  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])
  
  if (!isOpen) return null
  
  const isSessionReady = sessionMode === 'existing' 
    ? !!selectedSessionId 
    : !!newSessionName.trim()
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />
      
      {/* Overlay Container */}
      <div 
        className="fixed inset-4 md:inset-6 lg:inset-10 z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <div 
          className="relative w-full max-w-5xl max-h-full overflow-hidden rounded-2xl
                     bg-card/95 dark:bg-background/95 backdrop-blur-2xl 
                     border border-border dark:border-white/10 
                     shadow-2xl shadow-black/20
                     animate-in zoom-in-95 fade-in duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Subtle scanline overlay for atmosphere */}
          <div 
            className="absolute inset-0 pointer-events-none opacity-[0.02] z-0"
            style={{
              backgroundImage: `repeating-linear-gradient(
                0deg,
                transparent,
                transparent 2px,
                hsl(var(--primary) / 0.03) 2px,
                hsl(var(--primary) / 0.03) 4px
              )`,
            }}
          />
          
          {/* Header */}
          <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border dark:border-white/10">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Animate Still</h2>
                <p className="text-xs text-muted-foreground">Transform your image into a cinematic video iteration</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-lg hover:bg-muted h-9 w-9 transition-colors text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          {/* Content */}
          <div className="relative z-10 flex flex-col lg:flex-row gap-0 max-h-[calc(100vh-12rem)] overflow-hidden">
            {/* Left Panel: Source Image + Controls */}
            <div className="flex-1 p-6 space-y-6 overflow-y-auto border-r border-border dark:border-white/10 custom-scrollbar">
              {/* Source Image Preview */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black/40 border border-white/10 shadow-inner group">
                <img
                  src={imageUrl}
                  alt="Source image"
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/60 text-white text-[10px] font-semibold tracking-wider uppercase backdrop-blur-md border border-white/10">
                  Source Image
                </div>
              </div>
              
              {/* Controls Group */}
              <div className="space-y-5">
                {/* Session Picker */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Target Video Session</label>
                    <Tabs 
                      value={sessionMode} 
                      onValueChange={(v) => setSessionMode(v as 'existing' | 'new')}
                    >
                      <TabsList className="h-8 bg-muted/50 p-0.5 rounded-lg border border-border/50">
                        <TabsTrigger 
                          value="existing" 
                          disabled={videoSessions.length === 0}
                          className="px-3 py-1 text-[11px] font-semibold rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground transition-all"
                        >
                          Existing
                        </TabsTrigger>
                        <TabsTrigger 
                          value="new"
                          className="px-3 py-1 text-[11px] font-semibold rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground transition-all"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          New
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                  
                  <div className="flex gap-2">
                    {sessionMode === 'existing' ? (
                      <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                        <SelectTrigger className="flex-1 bg-muted/50 border-border h-10 text-sm rounded-lg hover:bg-muted transition-colors">
                          <SelectValue placeholder="Select video session..." />
                        </SelectTrigger>
                        <SelectContent className="bg-card/95 backdrop-blur-xl border-border rounded-lg">
                          {videoSessions.map((session) => (
                            <SelectItem key={session.id} value={session.id} className="rounded-md">
                              <div className="flex items-center gap-2">
                                <Video className="h-3.5 w-3.5 text-primary/70" />
                                <span>{session.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="relative flex-1">
                        <Input
                          placeholder="Enter new session name..."
                          value={newSessionName}
                          onChange={(e) => setNewSessionName(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newSessionName.trim()) {
                              e.preventDefault()
                              handleGenerate(prompt)
                            }
                          }}
                          className="bg-muted/50 border-border h-10 text-sm rounded-lg focus:ring-primary/20 focus:bg-background pl-10"
                          autoFocus={sessionMode === 'new'}
                        />
                        <Plus className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Video Generation Controls */}
                <div className="space-y-3 pt-2 border-t border-border/50">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Generation Settings</label>
                  <VideoInput
                    prompt={prompt}
                    onPromptChange={setPrompt}
                    onGenerate={handleGenerate}
                    parameters={parameters}
                    onParametersChange={setParameters}
                    selectedModel={selectedModel}
                    onModelSelect={setSelectedModel}
                    referenceImageUrl={imageUrl}
                    variant="overlay"
                    lockedReferenceImage={true}
                    hideReferencePicker={true}
                    referenceImageIdOverride={outputId}
                    showGenerateButton={true}
                    isGenerating={generateMutation.isPending || isCreatingSession}
                  />
                </div>
              </div>
              
              {/* Generation status indicator */}
              {generateMutation.isPending && (
                <div className="flex items-center gap-3 text-xs text-foreground bg-primary/15 border border-primary/25 rounded-lg px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <div className="flex flex-col">
                    <span className="font-semibold">Generating video...</span>
                    <span className="text-[10px] text-muted-foreground">Typically takes 30-60 seconds.</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Right Panel: Iteration History */}
            <div className="w-full lg:w-96 flex flex-col bg-muted/30 dark:bg-black/30 border-l border-border/50 dark:border-white/5 shadow-2xl">
              <div className="px-5 py-4 border-b border-border dark:border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Iterations</h3>
                </div>
                <div className="flex items-center gap-2">
                  {/* Sync button - visible when there are processing generations */}
                  {hasProcessing && (
                    <button
                      onClick={handleSyncStuck}
                      disabled={isSyncing}
                      className="p-1 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      title="Sync stuck generations with Replicate"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  <span className="text-[10px] font-semibold text-foreground bg-muted px-2 py-0.5 rounded-md border border-border">
                    {count}
                  </span>
                </div>
              </div>
              
              {/* Iteration List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {hasProcessing && (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 mb-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-xs font-semibold text-primary uppercase tracking-tight">Active Generation</span>
                  </div>
                )}
                
                {iterations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                    <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4 border border-border">
                      <Video className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-semibold text-foreground/80">No iterations yet</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-[200px]">Enter a prompt and click generate to create your first video iteration.</p>
                  </div>
                ) : (
                  iterations.map((iteration) => (
                    <IterationCard 
                      key={iteration.id} 
                      iteration={iteration}
                      onReuseParameters={(iter) => {
                        setPrompt(iter.prompt)
                        if (iter.modelId) setSelectedModel(iter.modelId)
                        const params = iter.parameters as any
                        if (params) {
                          setParameters(prev => ({
                            ...prev,
                            ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
                            ...(params.resolution && { resolution: params.resolution }),
                            ...(params.duration && { duration: params.duration }),
                          }))
                        }
                      }}
                      onBookmark={handleToggleBookmark}
                      onApprove={handleToggleApproval}
                      onDelete={handleDeleteGeneration}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Format model ID to a readable display name
 */
function formatModelName(modelId: string): string {
  const modelNames: Record<string, string> = {
    'gemini-veo-3.1': 'Veo 3.1',
    'kling-official': 'Kling 2.6',
    'replicate-kling-2.6': 'Kling 2.6 (Replicate)',
    'minimax-video-01': 'MiniMax',
  }
  return modelNames[modelId] || modelId.replace(/-/g, ' ').replace(/^(gemini|replicate|fal)\s*/i, '')
}

/**
 * Card showing a single video iteration
 */
function IterationCard({ 
  iteration,
  onReuseParameters,
  onBookmark,
  onApprove,
  onDelete,
}: { 
  iteration: VideoIteration
  onReuseParameters?: (iteration: VideoIteration) => void
  onBookmark?: (outputId: string, isBookmarked: boolean) => void
  onApprove?: (outputId: string, isApproved: boolean) => void
  onDelete?: (generationId: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasOutput = iteration.outputs.length > 0
  const videoOutput = iteration.outputs[0]
  
  // Check if prompt is long enough to need expand
  const promptNeedsExpand = iteration.prompt.length > 150
  
  const statusColors = {
    processing: 'bg-primary/10 text-primary border-primary/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-destructive/10 text-destructive border-destructive/20',
    cancelled: 'bg-muted/50 text-muted-foreground border-border',
    queued: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }
  
  const StatusIcon = {
    processing: Loader2,
    completed: Check,
    failed: AlertCircle,
    cancelled: X,
    queued: Clock,
  }[iteration.status] || Clock

  // Handle video download
  const handleDownload = useCallback(async () => {
    if (!videoOutput?.fileUrl) return
    
    try {
      const response = await fetch(videoOutput.fileUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `video-${iteration.id.slice(0, 8)}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }, [videoOutput?.fileUrl, iteration.id])
  
  return (
    <div className="group rounded-xl border border-border bg-card/50 overflow-hidden hover:border-primary/30 transition-all duration-300 shadow-sm hover:shadow-xl">
      {/* Video Preview / Placeholder */}
      <div className="aspect-video bg-muted relative overflow-hidden">
        {hasOutput && iteration.status === 'completed' ? (
          <>
            <video
              src={videoOutput.fileUrl}
              className="w-full h-full object-cover"
              controls
              preload="metadata"
            />
            {/* Hover Overlay with Actions */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-10">
              {/* Top Left - Download + Reuse */}
              <div className="absolute top-2 left-2 pointer-events-auto flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload()
                  }}
                  className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5 text-white" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onReuseParameters?.(iteration)
                  }}
                  className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                  title="Reuse parameters"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-white" />
                </button>
              </div>
              
              {/* Top Right - Bookmark + Approval */}
              <div className="absolute top-2 right-2 pointer-events-auto flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (videoOutput) {
                      onBookmark?.(videoOutput.id, (videoOutput as any).isBookmarked || false)
                    }
                  }}
                  className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                  title={(videoOutput as any)?.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                >
                  <Bookmark className={`h-3.5 w-3.5 text-white ${(videoOutput as any)?.isBookmarked ? 'fill-white' : ''}`} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (videoOutput) {
                      onApprove?.(videoOutput.id, (videoOutput as any).isApproved || false)
                    }
                  }}
                  className={`p-1.5 backdrop-blur-sm rounded-lg transition-colors ${
                    (videoOutput as any)?.isApproved
                      ? 'bg-green-500/90 hover:bg-green-600/90'
                      : 'bg-white/20 hover:bg-white/30'
                  }`}
                  title={(videoOutput as any)?.isApproved ? 'Approved for review' : 'Approve for review'}
                >
                  <Check className="h-3.5 w-3.5 text-white" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/50 backdrop-blur-sm group/placeholder">
            <div className={`p-3 rounded-full ${statusColors[iteration.status].split(' ')[0]} border border-border mb-3`}>
              <StatusIcon className={`h-6 w-6 ${iteration.status === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {iteration.status === 'processing' ? 'Creating...' : iteration.status}
            </span>
            
            {/* Delete button for failed generations */}
            {iteration.status === 'failed' && onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(iteration.id)
                }}
                className="absolute top-2 right-2 p-1.5 bg-destructive/80 backdrop-blur-sm rounded-lg hover:bg-destructive transition-colors opacity-0 group-hover/placeholder:opacity-100"
                title="Delete failed generation"
              >
                <Trash2 className="h-3.5 w-3.5 text-white" />
              </button>
            )}
          </div>
        )}
      </div>
      
      {/* Metadata */}
      <div className="p-4 space-y-3">
        {/* Status Badge + Model (on right) */}
        <div className="flex items-center justify-between gap-2">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-tight border shrink-0 ${statusColors[iteration.status]}`}>
            <StatusIcon className={`h-3 w-3 ${iteration.status === 'processing' ? 'animate-spin' : ''}`} />
            <span>{iteration.status}</span>
          </div>
          
          {/* Model indicator - moved to right */}
          {iteration.modelId && (
            <span className="text-[10px] text-muted-foreground truncate" title={iteration.modelId}>
              {formatModelName(iteration.modelId)}
            </span>
          )}
        </div>
        
        {/* Prompt Preview with Expand */}
        <div className="relative">
          <p 
            className={`text-xs leading-relaxed text-muted-foreground group-hover:text-foreground transition-colors ${
              !isExpanded && promptNeedsExpand ? 'line-clamp-3' : ''
            }`}
          >
            {iteration.prompt}
          </p>
          
          {promptNeedsExpand && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  <span>Show more</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

