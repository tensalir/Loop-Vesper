'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { useApprovedOutputs } from '@/hooks/useApprovedOutputs'
import { useApprovedAssets } from '@/hooks/useApprovedAssets'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Download, Link2, AlertCircle } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function ReviewPage() {
  const router = useRouter()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: approvedOutputs = [], isLoading, refetch } = useApprovedOutputs()

  const [monthFilter, setMonthFilter] = useState<string>('')
  const [batchFilter, setBatchFilter] = useState<string>('')
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('')
  const { data: approvedAssetsRaw = [], isLoading: assetsLoading } = useApprovedAssets({})

  const monthOptions = useMemo(() => {
    const set = new Set(approvedAssetsRaw.map((a) => a.month).filter((v): v is string => Boolean(v)))
    return Array.from(set).sort()
  }, [approvedAssetsRaw])
  const batchOptions = useMemo(() => {
    const set = new Set(approvedAssetsRaw.map((a) => a.batch).filter((v): v is string => Boolean(v)))
    return Array.from(set).sort()
  }, [approvedAssetsRaw])

  const approvedAssets = useMemo(() => {
    let list = approvedAssetsRaw
    if (monthFilter) list = list.filter((a) => a.month === monthFilter)
    if (batchFilter) list = list.filter((a) => a.batch === batchFilter)
    if (matchStatusFilter === 'matched' || matchStatusFilter === 'unmatched') {
      list = list.filter((a) => a.matchStatus === matchStatusFilter)
    }
    return list
  }, [approvedAssetsRaw, monthFilter, batchFilter, matchStatusFilter])

  const handleOpenSession = (projectId: string, sessionId: string, outputId?: string) => {
    const url = `/projects/${projectId}?sessionId=${sessionId}${outputId ? `&outputId=${outputId}` : ''}`
    router.push(url)
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

      queryClient.invalidateQueries({ queryKey: ['approvedOutputs'] })
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
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading approved items...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review</h1>
          <p className="text-muted-foreground">
            {approvedOutputs.length} {approvedOutputs.length === 1 ? 'item' : 'items'} approved for review
          </p>
        </div>
      </div>

      {/* Approved assets (Monday ↔ Frontify) */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Approved assets (Monday ↔ Frontify)</h2>
        </div>
        {assetsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Select value={monthFilter || 'all'} onValueChange={(v) => setMonthFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All months</SelectItem>
                  {monthOptions.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={batchFilter || 'all'} onValueChange={(v) => setBatchFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All batches</SelectItem>
                  {batchOptions.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={matchStatusFilter || 'all'} onValueChange={(v) => setMatchStatusFilter(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Match status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="unmatched">Unmatched</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {approvedAssets.length === 0 ? (
                <p className="col-span-full text-muted-foreground py-6">No approved assets in this view. Run sync batch to ingest Monday and Frontify data.</p>
              ) : (
                approvedAssets.map((asset) => (
                  <div
                    key={asset.linkId}
                    className="rounded-xl border border-border bg-card p-4 space-y-2"
                  >
                    <p className="font-medium text-sm line-clamp-2">{asset.name}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      {asset.month && <span>{asset.month}</span>}
                      {asset.batch && <span>· {asset.batch}</span>}
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      {asset.matchStatus === 'matched' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check className="h-3.5 w-3.5" />
                          Matched {asset.matchRationale && `(${asset.matchRationale})`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Unmatched
                        </span>
                      )}
                      {asset.link_for_review && (
                        <a
                          href={asset.link_for_review}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5 inline mr-0.5" />
                          Figma
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {/* Generation approved outputs */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Approved generations</h2>
        {approvedOutputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-border">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Check className="h-7 w-7 text-primary" />
              </div>
              <p className="text-muted-foreground">
                Click the checkmark on any generation to approve it for review. Approved items will appear here.
              </p>
            </div>
          </div>
        ) : (
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
                  output.generation.session.id,
                  output.id
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
                      output.generation.session.id,
                      output.id
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
        )}
      </section>
    </div>
  )
}

