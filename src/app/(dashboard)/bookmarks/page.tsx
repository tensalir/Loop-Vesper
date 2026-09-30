'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Bookmark as BookmarkIcon, X, Download, ExternalLink, Copy, Check } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { toViewUrl } from '@/lib/storage/refs'

interface BookmarkedItem {
  id: string
  createdAt: string
  output: {
    id: string
    fileUrl: string
    fileType: string
    generation: {
      id: string
      prompt: string
      modelId: string
      session: {
        id: string
        name: string
        project: {
          id: string
          name: string
        }
      }
    }
  }
}

// Format model name for display
const formatModelName = (modelId: string): string => {
  return modelId
    .replace('gemini-', '')
    .replace('fal-', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Preview Modal Component
function BookmarkPreviewModal({
  bookmark,
  open,
  onClose,
  onRemoveBookmark,
}: {
  bookmark: BookmarkedItem | null
  open: boolean
  onClose: () => void
  onRemoveBookmark: (outputId: string) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (open) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [open, onClose])

  if (!open || !bookmark) return null

  const { output } = bookmark
  const { generation } = output
  const { prompt, modelId, session } = generation

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(toViewUrl(output.fileUrl))
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const extension = output.fileType === 'video' ? 'mp4' : 'png'
      link.download = `bookmark-${output.id}.${extension}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      toast({
        title: 'Downloaded',
        description: `${output.fileType === 'video' ? 'Video' : 'Image'} saved to downloads`,
      })
    } catch (error) {
      console.error('Download failed:', error)
      toast({
        title: 'Download failed',
        description: 'Failed to download file',
        variant: 'destructive',
      })
    }
  }

  const handleOpenInSession = () => {
    // Deep-link with sessionId AND outputId for precise scroll
    router.push(
      `/projects/${session.project.id}?sessionId=${session.id}&outputId=${output.id}`
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 md:p-8"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors z-10"
      >
        <X className="h-6 w-6 text-white" />
      </button>

      {/* Content Container - Side by side layout */}
      <div 
        className="flex flex-col md:flex-row items-stretch gap-6 max-w-6xl w-full max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Prompt Card */}
        <div className="w-full md:w-96 flex-shrink-0 bg-card rounded-xl p-6 border border-border flex flex-col" style={{ minHeight: '320px' }}>
          {/* Prompt */}
          <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative" style={{ maxHeight: '200px' }}>
            <p 
              className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
              onClick={handleCopyPrompt}
              title="Click to copy"
            >
              {prompt}
            </p>
            {copied ? (
              <Check className="h-3.5 w-3.5 absolute top-0 right-0 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2 text-xs text-muted-foreground mt-4">
            {/* Project */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Project:</span>
              <span className="font-medium">{session.project.name}</span>
            </div>

            {/* Session */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Session:</span>
              <span className="font-medium">{session.name}</span>
            </div>

            {/* Model */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Model:</span>
              <span className="font-medium">{formatModelName(modelId)}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenInSession}
              className="flex-1 gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open in Session
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onRemoveBookmark(output.id)
                onClose()
              }}
              className="text-muted-foreground hover:text-destructive"
              title="Remove bookmark"
            >
              <BookmarkIcon className="h-4 w-4 fill-current" />
            </Button>
          </div>
        </div>

        {/* Right: Media */}
        <div className="flex-1 flex items-center justify-center min-h-[300px] md:min-h-0">
          <div className="relative w-full h-full flex items-center justify-center">
            {output.fileType === 'video' ? (
              <video
                src={toViewUrl(output.fileUrl)}
                className="max-w-full max-h-[70vh] md:max-h-[80vh] object-contain rounded-lg shadow-2xl"
                controls
                autoPlay
                muted
                loop
              />
            ) : (
              <img
                src={toViewUrl(output.fileUrl)}
                alt={prompt.slice(0, 100)}
                className="max-w-full max-h-[70vh] md:max-h-[80vh] object-contain rounded-lg shadow-2xl"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BookmarksPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [bookmarks, setBookmarks] = useState<BookmarkedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBookmark, setSelectedBookmark] = useState<BookmarkedItem | null>(null)

  useEffect(() => {
    fetchBookmarks()
  }, [])

  const fetchBookmarks = async () => {
    try {
      const response = await fetch('/api/bookmarks')
      if (response.ok) {
        const data = await response.json()
        setBookmarks(data)
      } else {
        throw new Error('Failed to fetch bookmarks')
      }
    } catch (error) {
      console.error('Error fetching bookmarks:', error)
      toast({
        title: 'Error',
        description: 'Failed to load bookmarks',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveBookmark = async (outputId: string) => {
    try {
      const response = await fetch('/api/bookmarks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputId }),
      })

      if (response.ok) {
        toast({
          title: 'Bookmark removed',
          description: 'Item removed from bookmarks',
          variant: 'default',
        })
        setBookmarks(bookmarks.filter(b => b.output.id !== outputId))
      } else {
        throw new Error('Failed to remove bookmark')
      }
    } catch (error) {
      console.error('Error removing bookmark:', error)
      toast({
        title: 'Error',
        description: 'Failed to remove bookmark',
        variant: 'destructive',
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading bookmarks...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bookmarks</h1>
        <p className="text-muted-foreground">
          {bookmarks.length} {bookmarks.length === 1 ? 'item' : 'items'} bookmarked
        </p>
      </div>

      {/* Content */}
      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <BookmarkIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-semibold mb-2">No bookmarks yet</h2>
            <p className="text-muted-foreground mb-6">
              Bookmark your favorite generations to find them easily
            </p>
            <Button onClick={() => router.push('/projects')}>
              Browse Projects
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {bookmarks.map((bookmark) => (
            <div
              key={bookmark.id}
              className="group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all hover:border-primary/50"
            >
              {/* Image */}
              <div
                className="aspect-square cursor-pointer relative"
                onClick={() => setSelectedBookmark(bookmark)}
              >
                {bookmark.output.fileType === 'image' ? (
                  <img
                    src={toViewUrl(bookmark.output.fileUrl)}
                    alt="Bookmarked content"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <video
                    src={toViewUrl(bookmark.output.fileUrl)}
                    className="w-full h-full object-cover"
                  />
                )}
                
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <p className="text-white text-sm font-medium px-4 text-center">
                    View details
                  </p>
                </div>
              </div>

              {/* Info */}
              <div className="p-4 space-y-2">
                <p className="text-sm font-medium line-clamp-2">
                  {bookmark.output.generation.prompt}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {bookmark.output.generation.session.project.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveBookmark(bookmark.output.id)
                    }}
                    className="h-7 px-2"
                  >
                    <BookmarkIcon className="h-3.5 w-3.5 fill-current" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bookmark Preview Modal */}
      <BookmarkPreviewModal
        bookmark={selectedBookmark}
        open={!!selectedBookmark}
        onClose={() => setSelectedBookmark(null)}
        onRemoveBookmark={(outputId) => {
          handleRemoveBookmark(outputId)
          setSelectedBookmark(null)
        }}
      />
    </div>
  )
}

