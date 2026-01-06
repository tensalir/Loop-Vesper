'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Image as ImageIcon, Video, Bookmark, CheckCircle } from 'lucide-react'

interface NavbarProps {
  theme: 'light' | 'dark'
  generationType?: 'image' | 'video'
  onGenerationTypeChange?: (type: 'image' | 'video') => void
  showGenerationToggle?: boolean
}

export function Navbar({
  theme,
  generationType,
  onGenerationTypeChange,
  showGenerationToggle = false,
}: NavbarProps) {
  const router = useRouter()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center pt-4 px-4 pointer-events-none">
      <div className="flex items-center gap-1 h-12 px-3 rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-sm pointer-events-auto">
        {/* Logo */}
        <img
          src={theme === 'light' ? "/images/Loop Vesper (Black).svg" : "/images/Loop Vesper (White).svg"}
          alt="Loop Vesper Logo"
          className="h-4 object-contain cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => router.push('/projects')}
          title="Back to Projects"
        />

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-2" />

        {/* Generation Type Toggle */}
        {showGenerationToggle && onGenerationTypeChange && (
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-1">
            <Button
              variant={generationType === 'image' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onGenerationTypeChange('image')}
              className="h-8 w-8 p-0 rounded-md"
              title="Image generation"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <Button
              variant={generationType === 'video' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onGenerationTypeChange('video')}
              className="h-8 w-8 p-0 rounded-md"
              title="Video generation"
            >
              <Video className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-2" />

        {/* Bookmarks Button - Icon only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/bookmarks')}
          className="h-8 w-8 rounded-md"
          title="Bookmarks"
        >
          <Bookmark className="h-4 w-4" />
        </Button>

        {/* Approved Button - Icon only */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/projects?tab=review')}
          className="h-8 w-8 rounded-md"
          title="Approved assets"
        >
          <CheckCircle className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  )
}

