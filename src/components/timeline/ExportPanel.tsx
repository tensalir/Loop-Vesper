'use client'

import { useState } from 'react'
import { Download, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTimelineStore } from '@/store/timelineStore'
import { useEnqueueRender, useRenderJobs } from '@/hooks/useTimeline'
import { useTimelineAutosave } from '@/hooks/useTimelineAutosave'
import { msToTimecode } from '@/types/timeline'

interface ExportPanelProps {
  projectId: string
  className?: string
}

export function ExportPanel({ projectId, className }: ExportPanelProps) {
  const { sequence, setExportPanelOpen } = useTimelineStore()
  const [resolution, setResolution] = useState('1080')
  const { flushNow } = useTimelineAutosave(projectId, { autoSchedule: false })

  const enqueueMutation = useEnqueueRender(projectId, sequence?.id || '')
  const { data: renderData } = useRenderJobs(projectId, sequence?.id, !!sequence?.id)
  const renderJobs = renderData?.renderJobs ?? []

  const handleRender = async () => {
    if (!sequence?.id) return
    await flushNow()
    await enqueueMutation.mutateAsync(parseInt(resolution))
  }

  const canRender = sequence && sequence.durationMs > 0 && !enqueueMutation.isPending

  return (
    <div className={cn(
      'bg-card/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl p-4 space-y-4 timeline-enter',
      className
    )}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Export</h3>
        <button
          onClick={() => setExportPanelOpen(false)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Settings */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-20">Resolution</label>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720">720p</SelectItem>
              <SelectItem value="1080">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-20">Duration</label>
          <span className="text-xs font-mono">{msToTimecode(sequence?.durationMs ?? 0)}</span>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-20">Format</label>
          <span className="text-xs font-mono">H.264 / AAC / MP4</span>
        </div>
      </div>

      {/* Render button */}
      <Button
        onClick={handleRender}
        disabled={!canRender}
        className="w-full h-9"
      >
        {enqueueMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Rendering...
          </>
        ) : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Render Video
          </>
        )}
      </Button>

      {/* Recent render jobs */}
      {renderJobs.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/30">
          <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Recent Renders</h4>
          {renderJobs.slice(0, 3).map((job: any) => (
            <RenderJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}

function RenderJobCard({ job }: { job: any }) {
  const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
    queued: { icon: Loader2, color: 'text-muted-foreground', label: 'Queued' },
    processing: { icon: Loader2, color: 'text-primary', label: `${job.progress}%` },
    completed: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Complete' },
    failed: { icon: AlertCircle, color: 'text-destructive', label: 'Failed' },
  }

  const config = statusConfig[job.status] || statusConfig.queued
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/20 border border-border/20">
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', config.color, job.status === 'processing' && 'animate-spin')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] font-semibold', config.color)}>{config.label}</span>
          <span className="text-[9px] text-muted-foreground">{job.resolution}p</span>
        </div>
        {job.error && (
          <p className="text-[9px] text-destructive truncate">{job.error}</p>
        )}
      </div>
      {job.status === 'completed' && job.outputUrl && (
        <a
          href={job.outputUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded-md text-emerald-500 hover:bg-emerald-500/10 transition-colors"
          title="Download"
        >
          <Download className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}
