'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'

interface GenerationProgressProps {
  estimatedTime?: number // in seconds
  onComplete?: () => void
  aspectRatio?: string
  isVideo?: boolean
  startedAt?: number // timestamp in ms (from processingStartedAt or createdAt)
}

/**
 * Format seconds to MM:SS display
 */
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Easing-based progress calculation that:
 * - Reaches ~95% around the estimated time
 * - Continues creeping slowly up to 99% for slow generations
 * - Never hits 100% (that happens when the component unmounts)
 * 
 * Uses an asymptotic curve: progress = 1 - e^(-k * t)
 * where k is calibrated so we hit ~95% at estimatedTime
 */
function calculateProgress(elapsedSeconds: number, estimatedTime: number): number {
  // k = -ln(1 - 0.95) / estimatedTime ≈ 3 / estimatedTime
  // This gives us ~95% at estimatedTime
  const k = 3 / estimatedTime
  
  // Asymptotic curve: approaches 1 but never reaches it
  const rawProgress = 1 - Math.exp(-k * elapsedSeconds)
  
  // Cap at 99% - the final 1% is "reserved" for actual completion
  return Math.min(rawProgress * 100, 99)
}

export function GenerationProgress({
  estimatedTime = 30,
  onComplete,
  aspectRatio = '1:1',
  isVideo = false,
  startedAt,
}: GenerationProgressProps) {
  // Use provided startedAt or fall back to current time
  const actualStartTime = useMemo(() => startedAt || Date.now(), [startedAt])
  
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    return Math.max(0, (Date.now() - actualStartTime) / 1000)
  })

  // Update elapsed time on interval
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = (Date.now() - actualStartTime) / 1000
      setElapsedSeconds(Math.max(0, elapsed))
    }, 500)

    return () => clearInterval(interval)
  }, [actualStartTime])

  // Calculate display progress using easing curve
  const displayProgress = Math.round(calculateProgress(elapsedSeconds, estimatedTime))
  
  // Calculate estimated remaining time (only show if we have a reasonable estimate)
  const estimatedRemaining = Math.max(0, estimatedTime - elapsedSeconds)
  const showRemaining = elapsedSeconds < estimatedTime * 1.5 // Hide if way over estimate

  const getAspectRatioStyle = (ratio: string) => {
    return ratio.replace(':', ' / ')
  }

  // Calculate the perimeter percentage for the border animation
  const borderProgress = displayProgress / 100

  return (
    <div
      className="relative rounded-xl"
      style={{ aspectRatio: getAspectRatioStyle(aspectRatio) }}
    >
      {/* Background */}
      <div className="absolute inset-0 rounded-xl bg-background/50 border border-border/30" />
      
      {/* Animated border - only the stroke, not fill */}
      <svg 
        className="absolute inset-0 w-full h-full rounded-xl"
        style={{ overflow: 'visible' }}
      >
        {/* Background border track */}
        <rect
          x="1.5"
          y="1.5"
          width="calc(100% - 3px)"
          height="calc(100% - 3px)"
          rx="11"
          ry="11"
          fill="none"
          stroke="hsl(var(--border) / 0.2)"
          strokeWidth="2"
          className="w-[calc(100%-3px)] h-[calc(100%-3px)]"
        />
        {/* Animated progress border */}
        <rect
          x="1.5"
          y="1.5"
          width="calc(100% - 3px)"
          height="calc(100% - 3px)"
          rx="11"
          ry="11"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          className="w-[calc(100%-3px)] h-[calc(100%-3px)]"
          style={{
            strokeDasharray: '1000',
            strokeDashoffset: `${1000 - (borderProgress * 1000)}`,
            transition: 'stroke-dashoffset 0.5s ease-out',
            filter: 'drop-shadow(0 0 4px hsl(var(--primary) / 0.5))',
          }}
        />
      </svg>

      {/* Main content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 sm:p-6">
        {/* Spinner icon */}
        <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 text-primary animate-spin mb-3" />
        
        {/* Title */}
        <div className="text-sm sm:text-base font-medium text-foreground/80 mb-2">
          {isVideo ? 'Generating video' : 'Generating image'}
        </div>

        {/* Large percentage */}
        <div className="text-3xl sm:text-4xl font-bold text-primary tabular-nums mb-2">
          {displayProgress}%
        </div>

        {/* Timer info */}
        <div className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatTime(elapsedSeconds)} elapsed</span>
          {showRemaining && estimatedRemaining > 0 && (
            <span className="tabular-nums text-muted-foreground/70">
              ~{formatTime(estimatedRemaining)} remaining
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
