'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface ScopeUsage {
  status: 'ok' | 'limited' | 'blocked'
  temporarilyBlocked?: boolean
  fallbackActive?: boolean
  minute: {
    used: number
    limit: number
    remaining: number
    resetInSeconds: number
    percentage: number
  }
  month: {
    used: number
    limit: number
    remaining: number
    resetInSeconds: number
    percentage: number
  }
}

interface RateLimitData {
  status: 'ok' | 'limited' | 'blocked'
  googleBackend: 'vertex' | 'gemini-api' | 'none'
  gemini: {
    nanoBanana: ScopeUsage
    veo: ScopeUsage
    overall: 'ok' | 'limited' | 'blocked'
  }
  replicate: {
    kling: ScopeUsage
    nanoBanana: ScopeUsage
    overall: 'ok' | 'limited' | 'blocked'
  }
  blockedProviders: Array<{
    provider: string
    scope: string
    resetInSeconds: number
  }>
  lastUpdated: string
}

interface GeminiRateLimitTrackerProps {
  isAdmin: boolean
}

/**
 * Format seconds into human readable time
 */
function formatResetTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    return `${mins}m`
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return `${hours}h`
  }
  const days = Math.floor(seconds / 86400)
  return `${days}d`
}

/**
 * Get status color classes
 */
function getStatusClasses(status: 'ok' | 'limited' | 'blocked'): string {
  switch (status) {
    case 'ok':
      return 'text-green-500'
    case 'limited':
      return 'text-amber-500'
    case 'blocked':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * Get status badge classes
 */
function getStatusBadgeClasses(status: 'ok' | 'limited' | 'blocked'): string {
  switch (status) {
    case 'ok':
      return 'bg-green-500/10 text-green-500 border-green-500/20'
    case 'limited':
      return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    case 'blocked':
      return 'bg-red-500/10 text-red-500 border-red-500/20'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/**
 * Get status label
 */
function getStatusLabel(status: 'ok' | 'limited' | 'blocked'): string {
  switch (status) {
    case 'ok':
      return 'OK'
    case 'limited':
      return 'Limited'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Unknown'
  }
}

/**
 * Usage bar component
 */
function UsageBar({ percentage, status }: { percentage: number; status: 'ok' | 'limited' | 'blocked' }) {
  const bgClass = status === 'blocked' ? 'bg-red-500' : status === 'limited' ? 'bg-amber-500' : 'bg-green-500'
  
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full transition-all', bgClass)}
        style={{ width: `${Math.min(100, percentage)}%` }}
      />
    </div>
  )
}

/**
 * Scope usage display component
 */
function ScopeUsageDisplay({ 
  label, 
  usage,
  showFallback = false 
}: { 
  label: string
  usage: ScopeUsage 
  showFallback?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn('text-xs font-medium', getStatusClasses(usage.status))}>
          {getStatusLabel(usage.status)}
          {usage.fallbackActive && showFallback && (
            <span className="ml-1 text-muted-foreground">(fallback)</span>
          )}
        </span>
      </div>
      
      {/* RPM */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>RPM</span>
          <span>{usage.minute.used}/{usage.minute.limit} (resets in {formatResetTime(usage.minute.resetInSeconds)})</span>
        </div>
        <UsageBar percentage={usage.minute.percentage} status={usage.status} />
      </div>
      
      {/* Monthly */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Monthly</span>
          <span>{usage.month.used}/{usage.month.limit} (resets in {formatResetTime(usage.month.resetInSeconds)})</span>
        </div>
        <UsageBar percentage={usage.month.percentage} status={usage.status} />
      </div>
    </div>
  )
}

export function GeminiRateLimitTracker({ isAdmin }: GeminiRateLimitTrackerProps) {
  const [data, setData] = useState<RateLimitData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false)
      return
    }

    fetchRateLimits()
    // Refresh every 30 seconds
    const interval = setInterval(fetchRateLimits, 30000)
    return () => clearInterval(interval)
  }, [isAdmin])

  const fetchRateLimits = async () => {
    try {
      const response = await fetch('/api/analytics/rate-limits')
      if (response.ok) {
        const json = await response.json()
        setData(json)
      }
    } catch (error) {
      console.error('Failed to fetch rate limits:', error)
    } finally {
      setLoading(false)
    }
  }

  // Don't render if not admin
  if (!isAdmin) {
    return null
  }

  const status = data?.status || 'ok'
  const statusLabel = `Gemini ${getStatusLabel(status)}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="default"
          className={cn(
            'h-8 px-2 font-medium text-xs transition-all',
            getStatusBadgeClasses(status),
            'hover:opacity-80'
          )}
          title="Click to view Gemini rate limits"
        >
          {loading ? (
            <span className="text-muted-foreground">...</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full', 
                status === 'ok' ? 'bg-green-500' : 
                status === 'limited' ? 'bg-amber-500' : 'bg-red-500'
              )} />
              {statusLabel}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" className="w-80 p-0" align="end">
        <div className="p-4 space-y-4">
          <div className="border-b border-border pb-2">
            <h3 className="font-semibold text-sm">Rate Limits</h3>
            <p className="text-xs text-muted-foreground">
              API usage and limits for generation models
            </p>
          </div>

          {data ? (
            <div className="space-y-4">
              {/* Google Gemini Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Google
                    </span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-medium',
                      data.googleBackend === 'vertex' 
                        ? 'bg-green-500/20 text-green-500' 
                        : data.googleBackend === 'gemini-api'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-red-500/20 text-red-400'
                    )}>
                      {data.googleBackend === 'vertex' ? 'Vertex AI' : 
                       data.googleBackend === 'gemini-api' ? 'AI Studio' : 'Not configured'}
                    </span>
                  </div>
                  <span className={cn('text-xs', getStatusClasses(data.gemini.overall))}>
                    {getStatusLabel(data.gemini.overall)}
                  </span>
                </div>
                
                {data.googleBackend === 'vertex' && (
                  <p className="text-[10px] text-muted-foreground/60 -mt-1">
                    Higher limits with pay-per-use billing
                  </p>
                )}
                {data.googleBackend === 'gemini-api' && (
                  <p className="text-[10px] text-amber-500/80 -mt-1">
                    Free tier with restrictive limits (~5-10 RPM)
                  </p>
                )}
                
                <ScopeUsageDisplay 
                  label="Nano Banana Pro" 
                  usage={data.gemini.nanoBanana}
                  showFallback
                />
                
                <ScopeUsageDisplay 
                  label="Veo 3.1" 
                  usage={data.gemini.veo}
                  showFallback
                />
              </div>

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Replicate Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Replicate (Fallback)
                  </span>
                  <span className={cn('text-xs', getStatusClasses(data.replicate.overall))}>
                    {getStatusLabel(data.replicate.overall)}
                  </span>
                </div>
                
                <ScopeUsageDisplay 
                  label="Kling 2.6 (Video)" 
                  usage={data.replicate.kling}
                />
                
                <ScopeUsageDisplay 
                  label="Nano Banana (Image)" 
                  usage={data.replicate.nanoBanana}
                />
              </div>

              {/* Blocked providers warning */}
              {data.blockedProviders.length > 0 && (
                <>
                  <div className="border-t border-border" />
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                    <p className="text-xs font-medium text-red-500 mb-1">Temporarily Blocked</p>
                    {data.blockedProviders.map((block, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        {block.scope}: retry in {formatResetTime(block.resetInSeconds)}
                      </p>
                    ))}
                  </div>
                </>
              )}

              {/* Fallback info */}
              {(data.gemini.nanoBanana.fallbackActive || data.gemini.veo.fallbackActive) && (
                <>
                  <div className="border-t border-border" />
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {data.gemini.nanoBanana.fallbackActive && data.gemini.veo.fallbackActive
                        ? 'Both Nano Banana and Veo are routing to Replicate fallbacks.'
                        : data.gemini.nanoBanana.fallbackActive
                        ? 'Nano Banana Pro is routing to Replicate fallback.'
                        : 'Veo 3.1 is routing to Kling 2.6 fallback.'}
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Loading rate limits...
            </p>
          )}

          {data?.lastUpdated && (
            <p className="text-xs text-muted-foreground text-center border-t border-border pt-2">
              Updated {new Date(data.lastUpdated).toLocaleTimeString()}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
