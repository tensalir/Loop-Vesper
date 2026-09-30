'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download as DownloadIcon, ExternalLink, History } from 'lucide-react'
import { useDownloadHistory, type DownloadHistoryItem } from '@/hooks/useDownloadHistory'
import { useToast } from '@/components/ui/use-toast'
import { toViewUrl } from '@/lib/storage/refs'

interface DownloadHistoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Per-user download history modal. Each tile shows a previously-downloaded
 * image/video and offers two actions:
 *   - Download again (re-saves the file; also re-logs the OutputEvent and
 *     refreshes the history)
 *   - Open in session (deep-link back to the source generation)
 *
 * Mirrors the grid + card composition used by the `/bookmarks` page so the
 * visual language stays consistent across "save-like" surfaces.
 */
export function DownloadHistoryModal({ open, onOpenChange }: DownloadHistoryModalProps) {
  const { data: items = [], isLoading, refetch } = useDownloadHistory()
  const router = useRouter()
  const { toast } = useToast()
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null)

  const handleOpenInSession = (item: DownloadHistoryItem) => {
    onOpenChange(false)
    router.push(
      `/projects/${item.project.id}?sessionId=${item.session.id}&outputId=${item.outputId}`,
    )
  }

  const handleRedownload = async (item: DownloadHistoryItem) => {
    setRedownloadingId(item.outputId)
    try {
      const response = await fetch(toViewUrl(item.fileUrl))
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const extension = item.fileType === 'video' ? 'mp4' : 'png'
      link.download = `vesper-${item.outputId}.${extension}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      // Re-log the download event so the history surfaces this re-save and
      // future cache reads stay accurate.
      void fetch(`/api/outputs/${item.outputId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'download',
          metadata: { fileType: item.fileType, source: 'history' },
        }),
      }).then(() => refetch())

      toast({
        title: 'Downloaded',
        description: `${item.fileType === 'video' ? 'Video' : 'Image'} saved to downloads`,
      })
    } catch (error) {
      console.error('Redownload failed:', error)
      toast({
        title: 'Download failed',
        description: 'Could not save this file again.',
        variant: 'destructive',
      })
    } finally {
      setRedownloadingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Download history
          </DialogTitle>
          <DialogDescription>
            Everything you&apos;ve downloaded from Vesper, kept here even if you remove the file locally.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Loading download history...</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <DownloadIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold mb-1">No downloads yet</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Download any generated image or video and it&apos;ll show up here. Even if you remove the local file, the original stays accessible.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((item) => (
                <div
                  key={item.outputId}
                  className="group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all hover:border-primary/50"
                >
                  <div className="aspect-square relative bg-muted">
                    {item.fileType === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={toViewUrl(item.fileUrl)}
                        alt={item.prompt.slice(0, 100)}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={toViewUrl(item.fileUrl)}
                        className="w-full h-full object-cover"
                        muted
                      />
                    )}
                  </div>

                  <div className="p-3 space-y-2">
                    <p className="text-xs font-medium line-clamp-2 leading-snug">
                      {item.prompt || 'Untitled'}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {item.project.name} &middot; {item.session.name}
                    </p>
                    <div className="flex items-center gap-1.5 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 px-2 text-xs gap-1.5"
                        onClick={() => handleOpenInSession(item)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1.5"
                        disabled={redownloadingId === item.outputId}
                        onClick={() => handleRedownload(item)}
                        title="Download again"
                      >
                        <DownloadIcon className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
