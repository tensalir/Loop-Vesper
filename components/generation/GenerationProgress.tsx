'use client'

import { useEffect, useState, useMemo } from 'react'

interface GenerationProgressProps {
  estimatedTime?: number // in seconds
  onComplete?: () => void
  aspectRatio?: string
  isVideo?: boolean
}

// Generation stages with cumulative thresholds (percentage of total time)
const GENERATION_STAGES = [
  { name: 'Initializing models', threshold: 0.15 }, // 0-15%
  { name: 'Processing prompt', threshold: 0.40 }, // 15-40%
  { name: 'Generating frames', threshold: 0.85 }, // 40-85%
  { name: 'Finalizing output', threshold: 1.0 }, // 85-100%
]

// CSS keyframe animation circumference calculation
// Circle radius = 42, circumference = 2 * PI * 42 ≈ 263.89
const CIRCUMFERENCE = 2 * Math.PI * 42

export function GenerationProgress({
  estimatedTime = 30,
  onComplete,
  aspectRatio = '1:1',
  isVideo = false,
}: GenerationProgressProps) {
  // Track start time for stage calculation (much slower update rate)
  const [startTime] = useState(() => Date.now())
  const [stageIndex, setStageIndex] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)

  // Update stage text and display progress on a slow interval (every 2 seconds)
  // This is only for the text - the circle animation is pure CSS
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsedSeconds = (Date.now() - startTime) / 1000
      const progressRatio = Math.min(elapsedSeconds / estimatedTime, 0.95)
      
      // Update display percentage (for the center text)
      setDisplayProgress(Math.round(progressRatio * 100))

      // Determine current stage based on elapsed time
      for (let i = 0; i < GENERATION_STAGES.length; i++) {
        if (progressRatio < GENERATION_STAGES[i].threshold) {
          setStageIndex(i)
          break
        }
      }
    }, 2000) // Update every 2 seconds (was 100ms)

    return () => clearInterval(interval)
  }, [startTime, estimatedTime])

  const getAspectRatioStyle = (ratio: string) => {
    return ratio.replace(':', ' / ')
  }

  // Memoize the animation duration style
  const animationStyle = useMemo(
    () => ({
      // Animate from full circumference (0%) to 5% remaining (95% progress)
      strokeDasharray: CIRCUMFERENCE,
      strokeDashoffset: CIRCUMFERENCE,
      animation: `progress-fill ${estimatedTime}s ease-out forwards`,
    }),
    [estimatedTime]
  )

  return (
    <div
      className="relative bg-gradient-to-br from-muted/30 to-muted/10 rounded-xl overflow-hidden border border-border/50"
      style={{ aspectRatio: getAspectRatioStyle(aspectRatio) }}
    >
      {/* CSS Keyframe animation */}
      <style jsx>{`
        @keyframes progress-fill {
          from {
            stroke-dashoffset: ${CIRCUMFERENCE};
          }
          to {
            stroke-dashoffset: ${CIRCUMFERENCE * 0.05};
          }
        }
      `}</style>

      {/* Main content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
        {/* Simple circular progress indicator */}
        <div className="relative w-24 h-24">
          <svg className="w-full h-full -rotate-90">
            {/* Background circle */}
            <circle
              cx="48"
              cy="48"
              r="42"
              stroke="currentColor"
              strokeWidth="6"
              fill="none"
              className="text-muted-foreground/20"
              strokeLinecap="round"
            />
            {/* Progress circle - CSS animated */}
            <circle
              cx="48"
              cy="48"
              r="42"
              stroke="currentColor"
              strokeWidth="6"
              fill="none"
              className="text-primary"
              strokeLinecap="round"
              style={animationStyle}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-primary">
            {displayProgress}%
          </div>
        </div>

        {/* Stage text below */}
        <p className="text-sm text-muted-foreground mt-4">
          {GENERATION_STAGES[stageIndex]?.name || 'Processing...'}
        </p>
      </div>
    </div>
  )
}
