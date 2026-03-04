'use client'

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search, Loader2, Video, Clock, Plus } from 'lucide-react'
import { useProjectVideos, useLoadMoreObserver, type BrowseVideo } from '@/hooks/useVideoBrowse'

interface VideoBrowseModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectVideo: (videoUrl: string, outputId: string, durationMs: number) => void
  projectId: string
}

export function VideoBrowseModal({
  isOpen,
  onClose,
  onSelectVideo,
  projectId,
}: VideoBrowseModalProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const projectQuery = useProjectVideos(projectId, isOpen)
  const videos = useMemo(
    () => projectQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [projectQuery.data]
  )

  const filteredVideos = useMemo(() => {
    if (!searchQuery) return videos
    const q = searchQuery.toLowerCase()
    return videos.filter((v) => v.prompt.toLowerCase().includes(q))
  }, [videos, searchQuery])

  const sentinelRef = useLoadMoreObserver(
    projectQuery.hasNextPage,
    projectQuery.isFetchingNextPage,
    projectQuery.fetchNextPage
  )

  const handleSelect = (video: BrowseVideo) => {
    onSelectVideo(video.url, video.id, video.durationMs ?? 5000)
  }

  const isInitialLoading = projectQuery.isLoading && !projectQuery.data
  const totalLoaded = videos.length

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[70vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Video Library</DialogTitle>
          <DialogDescription>
            Select a video from this project to add to your timeline
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 mt-1">
          {!isInitialLoading && totalLoaded > 0 && (
            <span className="text-xs text-muted-foreground">
              {searchQuery ? `${filteredVideos.length} of ${totalLoaded}` : totalLoaded} video{totalLoaded !== 1 ? 's' : ''}
              {projectQuery.hasNextPage ? '+' : ''}
            </span>
          )}
        </div>

        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto mt-3 pb-4">
          {isInitialLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-video rounded-lg bg-muted/50 animate-pulse"
                />
              ))}
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Video className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <p className="text-lg mb-2">No videos found</p>
              <p className="text-sm">Generate some videos first to browse them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-2">
              {filteredVideos.map((video) => (
                <VideoThumbnail
                  key={video.id}
                  video={video}
                  onSelect={handleSelect}
                />
              ))}
              <div ref={sentinelRef as React.RefObject<HTMLDivElement>} className="h-1" />
              {projectQuery.isFetchingNextPage && (
                <div className="col-span-full flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VideoThumbnail({
  video,
  onSelect,
}: {
  video: BrowseVideo
  onSelect: (video: BrowseVideo) => void
}) {
  const durationLabel = video.durationMs
    ? `${(video.durationMs / 1000).toFixed(1)}s`
    : null

  return (
    <button
      type="button"
      onClick={() => onSelect(video)}
      className="group relative aspect-video rounded-lg overflow-hidden border border-border/50 hover:border-primary/50 hover:shadow-lg transition-all duration-200 bg-muted/30 text-left"
    >
      {/* Poster image — no autoplay to avoid decode spikes */}
      <video
        src={video.url}
        className="w-full h-full object-cover"
        preload="metadata"
        muted
      />

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
        <div className="p-2 bg-primary rounded-full">
          <Plus className="h-4 w-4 text-primary-foreground" />
        </div>
      </div>

      {/* Duration badge */}
      {durationLabel && (
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[10px] text-white font-mono">
          <Clock className="h-2.5 w-2.5" />
          {durationLabel}
        </div>
      )}

      {/* Prompt preview */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
        <p className="text-[10px] text-white/80 line-clamp-2 leading-tight">
          {video.prompt}
        </p>
      </div>
    </button>
  )
}
