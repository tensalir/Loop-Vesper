'use client'

import { useState, memo, useMemo } from 'react'
import Image from 'next/image'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { Search, Loader2, FolderOpen, Image as ImageIcon } from 'lucide-react'
import {
  useProjectImages,
  useCrossProjectImages,
  useLoadMoreObserver,
  type BrowseImage,
} from '@/hooks/useImageBrowse'

interface ImageBrowseModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectImage: (imageUrl: string) => void
  projectId: string
}

export function ImageBrowseModal({
  isOpen,
  onClose,
  onSelectImage,
  projectId,
}: ImageBrowseModalProps) {
  const [activeTab, setActiveTab] = useState<'project' | 'all'>('project')
  const [searchQuery, setSearchQuery] = useState('')
  const [crossProjectFilter, setCrossProjectFilter] = useState<string | undefined>(undefined)

  // --- Current project images ---
  const projectQuery = useProjectImages(projectId, isOpen && activeTab === 'project')
  const projectImages = useMemo(
    () => projectQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [projectQuery.data]
  )

  // --- Cross-project images ---
  const crossQuery = useCrossProjectImages(isOpen && activeTab === 'all', crossProjectFilter)
  const crossImages = useMemo(
    () => crossQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [crossQuery.data]
  )
  const crossProjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    crossQuery.data?.pages.forEach((page) => {
      page.projects?.forEach((p) => map.set(p.id, p))
    })
    return Array.from(map.values())
  }, [crossQuery.data])

  // --- Filtered images ---
  const activeImages = activeTab === 'project' ? projectImages : crossImages
  const filteredImages = useMemo(() => {
    if (!searchQuery) return activeImages
    const q = searchQuery.toLowerCase()
    return activeImages.filter((img) => img.prompt.toLowerCase().includes(q))
  }, [activeImages, searchQuery])

  // --- Infinite scroll ---
  const activeQuery = activeTab === 'project' ? projectQuery : crossQuery
  const sentinelRef = useLoadMoreObserver(
    activeQuery.hasNextPage,
    activeQuery.isFetchingNextPage,
    activeQuery.fetchNextPage
  )

  // --- Handlers ---
  const handleSelectImage = (imageUrl: string) => {
    onSelectImage(imageUrl)
    onClose()
  }

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'project' | 'all')
    setSearchQuery('')
    setCrossProjectFilter(undefined)
  }

  const handleProjectFilter = (pid: string | undefined) => {
    setCrossProjectFilter(pid === crossProjectFilter ? undefined : pid)
  }

  // Group cross-project images by project for display
  const groupedByProject = useMemo(() => {
    if (activeTab !== 'all') return null
    const groups = new Map<string, { projectName: string; images: BrowseImage[] }>()
    for (const img of filteredImages) {
      const pid = img.projectId || 'unknown'
      if (!groups.has(pid)) {
        groups.set(pid, { projectName: img.projectName || 'Unknown Project', images: [] })
      }
      groups.get(pid)!.images.push(img)
    }
    return groups
  }, [filteredImages, activeTab])

  const isInitialLoading = activeQuery.isLoading && !activeQuery.data
  const showCount = filteredImages.length
  const totalLoaded = activeImages.length

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse Generated Images</DialogTitle>
          <DialogDescription>
            Select an image from your generations
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-3">
            <TabsList className="h-9 bg-muted/50 p-0.5">
              <TabsTrigger value="project" className="h-8 px-4 text-xs gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                This Project
              </TabsTrigger>
              <TabsTrigger value="all" className="h-8 px-4 text-xs gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                All Projects
              </TabsTrigger>
            </TabsList>

            {/* Image count */}
            {!isInitialLoading && totalLoaded > 0 && (
              <span className="text-xs text-muted-foreground">
                {searchQuery ? `${showCount} of ${totalLoaded}` : totalLoaded} image{totalLoaded !== 1 ? 's' : ''}
                {activeQuery.hasNextPage ? '+' : ''}
              </span>
            )}
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Cross-project filter chips */}
          {activeTab === 'all' && crossProjects.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Button
                variant={!crossProjectFilter ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCrossProjectFilter(undefined)}
                className="h-7 text-xs"
              >
                All
              </Button>
              {crossProjects.map((project) => (
                <Button
                  key={project.id}
                  variant={crossProjectFilter === project.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleProjectFilter(project.id)}
                  className="h-7 text-xs"
                >
                  {project.name}
                </Button>
              ))}
            </div>
          )}

          {/* Content */}
          <TabsContent value="project" className="flex-1 overflow-y-auto mt-3 data-[state=inactive]:hidden">
            <ImageGrid
              images={filteredImages}
              isLoading={isInitialLoading}
              isFetchingMore={projectQuery.isFetchingNextPage}
              hasMore={projectQuery.hasNextPage}
              sentinelRef={sentinelRef}
              onSelect={handleSelectImage}
              emptyMessage="No images in this project yet"
              emptySubMessage="Generate some images first to browse them here"
            />
          </TabsContent>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-3 data-[state=inactive]:hidden">
            {crossProjectFilter || !groupedByProject || groupedByProject.size <= 1 ? (
              // Flat grid when filtering by project or only one project
              <ImageGrid
                images={filteredImages}
                isLoading={isInitialLoading}
                isFetchingMore={crossQuery.isFetchingNextPage}
                hasMore={crossQuery.hasNextPage}
                sentinelRef={sentinelRef}
                onSelect={handleSelectImage}
                showProjectBadge
                emptyMessage="No images found across your projects"
                emptySubMessage="Images from projects you own, are a member of, or that are shared will appear here"
              />
            ) : (
              // Grouped by project
              <div className="space-y-6 pb-4">
                {Array.from(groupedByProject.entries()).map(([pid, group]) => (
                  <div key={pid}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
                        {group.projectName}
                      </div>
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground">
                        {group.images.length} image{group.images.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                      {group.images.map((image) => (
                        <ImageThumbnail
                          key={image.id}
                          image={image}
                          onSelect={handleSelectImage}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Infinite scroll sentinel */}
                <div ref={sentinelRef as React.RefObject<HTMLDivElement>} className="h-1" />
                {crossQuery.isFetchingNextPage && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ----- Image Grid -----

function ImageGrid({
  images,
  isLoading,
  isFetchingMore,
  hasMore,
  sentinelRef,
  onSelect,
  showProjectBadge,
  emptyMessage,
  emptySubMessage,
}: {
  images: BrowseImage[]
  isLoading: boolean
  isFetchingMore: boolean
  hasMore: boolean | undefined
  sentinelRef: React.RefObject<HTMLDivElement | null>
  onSelect: (url: string) => void
  showProjectBadge?: boolean
  emptyMessage: string
  emptySubMessage: string
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-2">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg bg-muted/50 animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
          <ImageIcon className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <p className="text-lg mb-2">{emptyMessage}</p>
        <p className="text-sm">{emptySubMessage}</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-2">
        {images.map((image) => (
          <ImageThumbnail
            key={image.id}
            image={image}
            onSelect={onSelect}
            showProjectBadge={showProjectBadge}
          />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef as React.RefObject<HTMLDivElement>} className="h-1" />

      {isFetchingMore && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

// ----- Thumbnail -----

const ImageThumbnail = memo(function ImageThumbnail({
  image,
  onSelect,
  showProjectBadge,
}: {
  image: BrowseImage
  onSelect: (url: string) => void
  showProjectBadge?: boolean
}) {
  const [hasError, setHasError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  return (
    <button
      onClick={() => onSelect(image.url)}
      className="group relative aspect-square rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-all duration-200 hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-primary bg-muted/30"
      title={image.prompt}
    >
      {/* Loading skeleton */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-muted/50 animate-pulse" />
      )}

      {/* Thumbnail via next/image (auto-optimized, lazy-loaded, WebP/AVIF) */}
      {!hasError ? (
        <Image
          src={image.url}
          alt={image.prompt}
          fill
          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, 20vw"
          className={`object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200" />
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <p className="text-white text-xs line-clamp-2">{image.prompt}</p>
      </div>

      {/* Project badge (cross-project view) */}
      {showProjectBadge && image.projectName && (
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[8px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity">
          {image.projectName}
        </div>
      )}
    </button>
  )
})
