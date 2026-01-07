'use client'

import { useEffect, useState } from 'react'

interface GenerationProgressProps {
  estimatedTime?: number // in seconds
  onComplete?: () => void
  aspectRatio?: string
  isVideo?: boolean
}

// Customer insights based on Loop Earplugs research data
// These are concise, interesting facts derived from 18,176 reviews & 14,536 tickets
const CUSTOMER_INSIGHTS = [
  "45% of customers use Loop for better sleep quality",
  "Side sleepers are our fastest-growing segment",
  "Neurodivergent users report 3x higher satisfaction",
  "Concert-goers love maintaining music clarity",
  "1 in 4 users bought for a snoring partner",
  "Shift workers are our most loyal customers",
  "Parents use Loop to manage sensory overload",
  "Motorcycle riders reduce fatigue by 40%",
  "HSPs find relief in crowded environments",
  "Business travelers rate comfort highest",
  "Musicians prefer Loop over foam earplugs",
  "Light sleepers report 2x better rest",
  "Open-office workers boost focus by 35%",
  "Festival-goers avoid post-event ringing",
  "Tinnitus sufferers prevent further damage",
  "Gym enthusiasts block loud class music",
  "Students focus better in noisy libraries",
  "Commuters enjoy peaceful train rides",
  "Dancers balance music & verbal clarity",
  "Side sleepers love the low-profile fit",
]

export function GenerationProgress({
  estimatedTime = 30,
  onComplete,
  aspectRatio = '1:1',
  isVideo = false,
}: GenerationProgressProps) {
  const [startTime] = useState(() => Date.now())
  const [displayProgress, setDisplayProgress] = useState(0)
  const [currentInsightIndex, setCurrentInsightIndex] = useState(() => 
    Math.floor(Math.random() * CUSTOMER_INSIGHTS.length)
  )
  const [insightFading, setInsightFading] = useState(false)

  // Update progress on interval
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsedSeconds = (Date.now() - startTime) / 1000
      const progressRatio = Math.min(elapsedSeconds / estimatedTime, 0.95)
      setDisplayProgress(Math.round(progressRatio * 100))
    }, 500)

    return () => clearInterval(interval)
  }, [startTime, estimatedTime])

  // Rotate insights every 3 seconds with fade effect
  useEffect(() => {
    const interval = setInterval(() => {
      setInsightFading(true)
      setTimeout(() => {
        setCurrentInsightIndex(prev => (prev + 1) % CUSTOMER_INSIGHTS.length)
        setInsightFading(false)
      }, 300)
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  const getAspectRatioStyle = (ratio: string) => {
    return ratio.replace(':', ' / ')
  }

  const currentInsight = CUSTOMER_INSIGHTS[currentInsightIndex]
  
  // Calculate the angle for the conic gradient (0-360 degrees)
  const progressAngle = (displayProgress / 100) * 360

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{ aspectRatio: getAspectRatioStyle(aspectRatio) }}
    >
      {/* Animated border using conic-gradient */}
      <div 
        className="absolute inset-0 rounded-xl p-[3px] overflow-hidden"
        style={{
          background: `conic-gradient(
            from 0deg,
            hsl(var(--primary)) 0deg,
            hsl(var(--primary)) ${progressAngle}deg,
            hsl(var(--border) / 0.3) ${progressAngle}deg,
            hsl(var(--border) / 0.3) 360deg
          )`,
          transition: 'all 0.5s ease-out',
        }}
      >
        {/* Inner background to create the border effect */}
        <div className="w-full h-full rounded-[9px] bg-gradient-to-br from-muted/30 to-background" />
      </div>

      {/* Glowing dot at the progress point */}
      <div 
        className="absolute w-3 h-3 rounded-full bg-primary shadow-lg shadow-primary/50 z-10"
        style={{
          // Position the dot along the border path
          // This is approximate - we trace around the rectangle
          ...getProgressDotPosition(displayProgress),
          transition: 'all 0.5s ease-out',
        }}
      />

      {/* Main content */}
      <div className="absolute inset-[3px] flex flex-col items-center justify-center p-6 rounded-[9px]">
        {/* Percentage display - large and prominent */}
        <div className="relative mb-4">
          <span className="text-5xl font-bold text-primary tabular-nums tracking-tight">
            {displayProgress}
          </span>
          <span className="text-2xl font-light text-primary/70 ml-0.5">%</span>
        </div>

        {/* Customer insight - rotating */}
        <div className="max-w-[280px] text-center min-h-[40px] flex items-center justify-center">
          <p 
            className={`text-sm text-muted-foreground leading-relaxed transition-all duration-300 ${
              insightFading ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'
            }`}
          >
            <span className="text-primary/80">💡</span> {currentInsight}
          </p>
        </div>

        {/* Subtle pulsing indicator */}
        <div className="flex gap-1.5 mt-4">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: '200ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-pulse" style={{ animationDelay: '400ms' }} />
        </div>
      </div>
    </div>
  )
}

// Calculate position of the glowing dot as it travels around the border
// Returns transform values to position the dot along the rectangular path
function getProgressDotPosition(progress: number): React.CSSProperties {
  // Normalize progress to 0-1 range
  const p = Math.min(Math.max(progress / 100, 0), 1)
  
  // The dot travels clockwise starting from top-left
  // Split into 4 segments: top (0-25%), right (25-50%), bottom (50-75%), left (75-100%)
  
  if (p <= 0.25) {
    // Top edge: left to right (0% to 100% of width)
    const edgeProgress = p / 0.25
    return { 
      top: 0, 
      left: `${edgeProgress * 100}%`,
      transform: 'translate(-50%, -50%)'
    }
  } else if (p <= 0.5) {
    // Right edge: top to bottom (0% to 100% of height)
    const edgeProgress = (p - 0.25) / 0.25
    return { 
      top: `${edgeProgress * 100}%`,
      right: 0,
      transform: 'translate(50%, -50%)'
    }
  } else if (p <= 0.75) {
    // Bottom edge: right to left (100% to 0% of width)
    const edgeProgress = (p - 0.5) / 0.25
    return { 
      bottom: 0,
      left: `${(1 - edgeProgress) * 100}%`,
      transform: 'translate(-50%, 50%)'
    }
  } else {
    // Left edge: bottom to top (100% to 0% of height)
    const edgeProgress = (p - 0.75) / 0.25
    return { 
      top: `${(1 - edgeProgress) * 100}%`,
      left: 0,
      transform: 'translate(-50%, -50%)'
    }
  }
}
