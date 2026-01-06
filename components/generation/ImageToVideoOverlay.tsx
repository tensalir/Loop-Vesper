'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Video, Plus, Play, Loader2, Check, Clock, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { VideoInput } from './VideoInput'
import { useVideoIterations, type VideoIteration } from '@/hooks/useVideoIterations'
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
  const [selectedModel, setSelectedModel] = useState('minimax-video-01')
  const [parameters, setParameters] = useState({
    aspectRatio: '16:9',
    resolution: 720,
    numOutputs: 1,
    duration: 6,
  })
  
  // Video iterations for this source image
  const { iterations, count, hasProcessing, latestStatus, refetch } = useVideoIterations(
    isOpen ? outputId : null,
    { limit: 20 }
  )
  
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
    options?: { referenceImage?: File; referenceImageId?: string }
  ) => {
    const sessionId = await ensureVideoSession()
    if (!sessionId) {
      console.error('No video session available')
      return
    }
    
    try {
      // Convert reference image to base64 if provided
      let referenceImageBase64: string | undefined
      if (options?.referenceImage) {
        referenceImageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(options.referenceImage!)
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
        },
      })
      
      // Refetch iterations to show the new one
      refetch()
      onGenerationStarted?.()
      
      // Invalidate the video session's generations
      queryClient.invalidateQueries({ queryKey: ['generations', sessionId] })
    } catch (error) {
      console.error('Video generation failed:', error)
    }
  }, [ensureVideoSession, generateMutation, selectedModel, parameters, outputId, refetch, onGenerationStarted, queryClient])
  
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
      <div className="fixed inset-4 md:inset-6 lg:inset-10 z-50 flex items-center justify-center">
        <div 
          className="relative w-full max-w-5xl max-h-full overflow-hidden rounded-2xl
                     bg-background/25 backdrop-blur-2xl 
                     border border-white/10 
                     shadow-2xl shadow-black/30
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
          <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-white">Animate Still</h2>
                <p className="text-xs text-muted-foreground">Transform your image into a cinematic video iteration</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-lg hover:bg-white/10 h-9 w-9 transition-colors"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          
          {/* Content */}
          <div className="relative z-10 flex flex-col lg:flex-row gap-0 max-h-[calc(100vh-12rem)] overflow-hidden">
            {/* Left Panel: Source Image + Controls */}
            <div className="flex-1 p-6 space-y-6 overflow-y-auto border-r border-white/10 custom-scrollbar">
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
                      <TabsList className="h-8 bg-white/5 p-0.5 rounded-lg border border-white/5">
                        <TabsTrigger 
                          value="existing" 
                          disabled={videoSessions.length === 0}
                          className="px-3 py-1 text-[11px] font-semibold rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all"
                        >
                          Existing
                        </TabsTrigger>
                        <TabsTrigger 
                          value="new"
                          className="px-3 py-1 text-[11px] font-semibold rounded-md data-[state=active]:bg-white/10 data-[state=active]:text-white transition-all"
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
                        <SelectTrigger className="flex-1 bg-white/5 border-white/10 h-10 text-sm rounded-lg hover:bg-white/10 transition-colors">
                          <SelectValue placeholder="Select video session..." />
                        </SelectTrigger>
                        <SelectContent className="bg-background/95 backdrop-blur-xl border-white/10 rounded-lg">
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
                          className="bg-white/5 border-white/10 h-10 text-sm rounded-lg focus:ring-primary/20 pl-10"
                        />
                        <Plus className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Video Generation Controls */}
                <div className="space-y-3 pt-2 border-t border-white/5">
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
                <div className="flex items-center gap-3 text-xs text-white bg-primary/15 border border-primary/25 rounded-lg px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <div className="flex flex-col">
                    <span className="font-semibold">Generating video...</span>
                    <span className="text-[10px] text-muted-foreground">Typically takes 30-60 seconds.</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Right Panel: Iteration History */}
            <div className="w-full lg:w-96 flex flex-col bg-black/30 border-l border-white/5 shadow-2xl">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Iterations</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-white bg-white/10 px-2 py-0.5 rounded-md border border-white/10">
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
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 border border-white/10">
                      <Video className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <p className="text-sm font-semibold text-white/80">No iterations yet</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-[200px]">Enter a prompt and click generate to create your first video iteration.</p>
                  </div>
                ) : (
                  iterations.map((iteration) => (
                    <IterationCard key={iteration.id} iteration={iteration} />
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
 * Card showing a single video iteration
 */
function IterationCard({ iteration }: { iteration: VideoIteration }) {
  const hasOutput = iteration.outputs.length > 0
  const videoOutput = iteration.outputs[0]
  
  const statusColors = {
    processing: 'bg-primary/10 text-primary border-primary/20',
    completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-destructive/10 text-destructive border-destructive/20',
    cancelled: 'bg-white/5 text-muted-foreground border-white/10',
    queued: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }
  
  const StatusIcon = {
    processing: Loader2,
    completed: Check,
    failed: AlertCircle,
    cancelled: X,
    queued: Clock,
  }[iteration.status] || Clock
  
  return (
    <div className="group rounded-xl border border-white/5 bg-white/[0.03] overflow-hidden hover:border-white/20 transition-all duration-300 shadow-sm hover:shadow-xl">
      {/* Video Preview / Placeholder */}
      <div className="aspect-video bg-black/40 relative overflow-hidden">
        {hasOutput && iteration.status === 'completed' ? (
          <video
            src={videoOutput.fileUrl}
            className="w-full h-full object-cover"
            controls
            preload="metadata"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className={`p-3 rounded-full ${statusColors[iteration.status].split(' ')[0]} border border-white/5 mb-3`}>
              <StatusIcon className={`h-6 w-6 ${iteration.status === 'processing' ? 'animate-spin' : ''}`} />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
              {iteration.status === 'processing' ? 'Creating...' : iteration.status}
            </span>
          </div>
        )}
      </div>
      
      {/* Metadata */}
      <div className="p-4 space-y-3">
        {/* Status Badge + Time */}
        <div className="flex items-center justify-between">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-tight border ${statusColors[iteration.status]}`}>
            <StatusIcon className={`h-3 w-3 ${iteration.status === 'processing' ? 'animate-spin' : ''}`} />
            <span>{iteration.status}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/60">
            <Clock className="h-3 w-3" />
            <span>{new Date(iteration.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
        
        {/* Prompt Preview */}
        <div className="relative">
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3 group-hover:text-white/80 transition-colors" title={iteration.prompt}>
            {iteration.prompt}
          </p>
        </div>
      </div>
    </div>
  )
}

