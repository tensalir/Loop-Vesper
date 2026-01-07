'use client'

import { useEffect, useState } from 'react'

interface GenerationProgressProps {
  estimatedTime?: number // in seconds
  onComplete?: () => void
  aspectRatio?: string
  isVideo?: boolean
}

// Specific customer insights from Loop Earplugs research (18,176 reviews & 14,536 tickets)
const CUSTOMER_INSIGHTS = [
  "Side sleepers say Loop's low-profile design lets them sleep on any pillow without discomfort",
  "Parents with ADHD kids report Loop helps reduce meltdowns during noisy family gatherings",
  "Concert photographers use Loop to protect hearing while staying aware of their surroundings",
  "Night shift nurses block daytime street noise to get deep sleep between 12-hour shifts",
  "Motorcyclists say wind noise fatigue drops dramatically on long highway rides with Loop",
  "Teachers with sensory sensitivity use Loop to stay calm in chaotic classrooms",
  "Music producers prefer Loop over foam because it preserves frequency balance for mixing",
  "New parents use Loop to take the edge off crying without losing baby monitor awareness",
  "Gym-goers block aggressive trainer music while still hearing safety cues and spotters",
  "Festival campers finally sleep through bass-heavy late-night sets at neighboring stages",
  "Remote workers in open-plan homes filter out family noise without full noise cancellation",
  "Baristas use Loop to reduce espresso machine fatigue during 8-hour coffee rush shifts",
  "Anxious flyers say Loop makes turbulence announcements less jarring and stressful",
  "Dog owners block fireworks panic while staying alert to comfort their anxious pets",
  "Students with autism study in busy libraries without sensory overload from chatter",
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

  // Rotate insights every 4 seconds with fade effect
  useEffect(() => {
    const interval = setInterval(() => {
      setInsightFading(true)
      setTimeout(() => {
        setCurrentInsightIndex(prev => (prev + 1) % CUSTOMER_INSIGHTS.length)
        setInsightFading(false)
      }, 300)
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  const getAspectRatioStyle = (ratio: string) => {
    return ratio.replace(':', ' / ')
  }

  const currentInsight = CUSTOMER_INSIGHTS[currentInsightIndex]
  
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
        {/* Percentage display */}
        <div className="relative mb-3">
          <span className="text-4xl sm:text-5xl font-bold text-primary tabular-nums tracking-tight">
            {displayProgress}
          </span>
          <span className="text-xl sm:text-2xl font-light text-primary/70 ml-0.5">%</span>
        </div>

        {/* Customer insight - more specific, more room */}
        <div className="max-w-[320px] text-center px-2">
          <p 
            className={`text-xs sm:text-sm text-muted-foreground leading-relaxed transition-all duration-300 ${
              insightFading ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'
            }`}
          >
            {currentInsight}
          </p>
        </div>
      </div>
    </div>
  )
}
