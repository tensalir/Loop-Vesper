'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Loader2, 
  Activity, 
  Image as ImageIcon, 
  Video, 
  Users,
  Zap,
  Globe,
  User,
  Lock,
  DollarSign,
  Sparkles,
  TrendingUp,
  Layers,
  Cpu,
  RefreshCcw,
  Play,
  Download,
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

// Color palette for charts and bars
const CHART_COLORS = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#10b981', // emerald
  '#f97316', // orange
  '#06b6d4', // cyan
  '#6366f1', // indigo
]

// Types for My usage stats (extended API shape)
interface MyUsageStats {
  totalGenerations: number
  totalImages: number
  totalVideos: number
  topModels: Array<{
    modelId: string
    modelName: string
    provider: string
    type: 'image' | 'video'
    count: number
    percentage: number
  }>
  byProvider?: Array<{
    provider: string
    count: number
    percentage: number
  }>
  byType?: Array<{
    type: 'image' | 'video'
    count: number
    percentage: number
  }>
}

// Types for spending stats
interface SpendingStats {
  totalCost: number
  totalGenerations: number
  providerBreakdown: Array<{
    provider: string
    totalCost: number
    generationCount: number
    models: Array<{
      modelName: string
      cost: number
      generationCount: number
    }>
  }>
}

// Types for Global usage stats (new API shape)
interface GlobalUsageStats {
  available: boolean
  message?: string
  totalGenerations?: number
  totalImages?: number
  totalVideos?: number
  topModels?: Array<{
    modelId: string
    modelName: string
    provider: string
    type: 'image' | 'video'
    count: number
    percentage: number
  }>
  byProvider?: Array<{
    provider: string
    count: number
    percentage: number
  }>
  byType?: Array<{
    type: 'image' | 'video'
    count: number
    percentage: number
  }>
  cohort?: {
    uniqueUsers: number
    minUsersRequired: number
  }
}

// Status responses for semantic analysis pipeline (admin only)
interface AnalysisProcessorStatus {
  queue: Record<string, number>
  total: {
    outputs: number
    analyzed: number
    pending: number
  }
}

interface BackfillStatus {
  totalOutputs: number
  analysis: {
    total: number
    byStatus: Record<string, number>
  }
  pendingBackfill: number
  percentComplete: number
}

// Types for global event/download statistics
interface EventStats {
  available: boolean
  message?: string
  summary?: {
    totalDownloads: number
    totalOutputsWithDownloads: number
    totalOutputs: number
    overallDownloadRate: number
  }
  byModel?: Array<{
    modelId: string
    modelName: string
    provider: string
    type: 'image' | 'video'
    downloadCount: number
    outputCount: number
    downloadRate: number
  }>
  byDownloadRate?: Array<{
    modelId: string
    modelName: string
    provider: string
    type: 'image' | 'video'
    downloadCount: number
    outputCount: number
    downloadRate: number
  }>
  cohort?: {
    uniqueDownloadUsers: number
    minUsersRequired: number
  }
}

// Donut Chart Component
function DonutChart({ 
  data, 
  total, 
  centerLabel,
  centerValue,
}: { 
  data: Array<{ label: string; value: number; percentage: number }>
  total: number
  centerLabel: string
  centerValue: string | number
}) {
  // Calculate segments
  let cumulativePercentage = 0
  const segments = data.map((item, index) => {
    const start = cumulativePercentage
    cumulativePercentage += item.percentage
    return {
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length],
      start,
      end: cumulativePercentage,
    }
  })

  // Generate conic gradient
  const gradientStops = segments.map((seg, i) => {
    const startAngle = (seg.start / 100) * 360
    const endAngle = (seg.end / 100) * 360
    return `${seg.color} ${startAngle}deg ${endAngle}deg`
  }).join(', ')

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Donut */}
      <div className="relative">
        <div 
          className="w-48 h-48 rounded-full"
          style={{
            background: `conic-gradient(${gradientStops})`,
          }}
        />
        {/* Center hole */}
        <div className="absolute inset-4 rounded-full bg-card flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
          <span className="text-2xl font-bold">{centerValue}</span>
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {segments.slice(0, 6).map((seg, i) => (
          <div key={seg.label} className="flex items-center gap-1.5 text-xs">
            <div 
              className="w-2.5 h-2.5 rounded-full" 
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-muted-foreground">
              {seg.label} ({seg.percentage.toFixed(1)}%)
            </span>
          </div>
        ))}
        {segments.length > 6 && (
          <span className="text-xs text-muted-foreground">+{segments.length - 6} more</span>
        )}
      </div>
    </div>
  )
}

// Stat Card with accent color
function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon,
  accentColor,
}: { 
  title: string
  value: string | number
  subtitle?: string
  icon: React.ElementType
  accentColor?: string
}) {
  return (
    <Card className="relative overflow-hidden">
      {accentColor && (
        <div 
          className="absolute top-0 left-0 w-1 h-full" 
          style={{ backgroundColor: accentColor }}
        />
      )}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div 
          className="p-2 rounded-lg" 
          style={{ backgroundColor: accentColor ? `${accentColor}20` : 'hsl(var(--muted))' }}
        >
          <Icon 
            className="h-4 w-4" 
            style={{ color: accentColor || 'hsl(var(--muted-foreground))' }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

// Model Usage Card (like the screenshot)
function ModelUsageCard({
  name,
  jobs,
  percentage,
  color,
  icon: Icon,
}: {
  name: string
  jobs: number
  percentage: number
  color: string
  icon?: React.ElementType
}) {
  const IconComponent = Icon || Sparkles
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <div 
            className="px-3 py-1 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {name}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" />
              Jobs
            </span>
            <span className="font-semibold">{jobs.toLocaleString()}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full transition-all"
              style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {percentage.toFixed(1)}% of total usage
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Colored Progress Bar
function ColoredProgressBar({ 
  label, 
  value, 
  percentage, 
  color,
  valueLabel,
  icon: Icon,
}: { 
  label: string
  value: number
  percentage: number
  color: string
  valueLabel?: string
  icon?: React.ElementType
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: color }}
          />
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <span className="font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-semibold text-foreground">{value.toLocaleString()}</span>
          <span className="text-xs">{valueLabel || 'generations'}</span>
          <span className="text-xs">({percentage.toFixed(1)}%)</span>
        </div>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full transition-all rounded-full"
          style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function MyAnalyticsContent() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<MyUsageStats | null>(null)
  const [spending, setSpending] = useState<SpendingStats | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch usage stats
        const usageResponse = await fetch('/api/analytics/usage')
        if (usageResponse.ok) {
          const data = await usageResponse.json()
          setStats(data)
        }

        // Check if admin and fetch spending
        const profileResponse = await fetch('/api/profile')
        if (profileResponse.ok) {
          const profile = await profileResponse.json()
          setIsAdmin(profile.role === 'admin')
          
          if (profile.role === 'admin') {
            const spendingResponse = await fetch('/api/analytics/spending')
            if (spendingResponse.ok) {
              const spendingData = await spendingResponse.json()
              setSpending(spendingData)
            }
          }
        }
      } catch (error) {
        console.error('Error fetching analytics:', error)
        toast({
          title: 'Error',
          description: 'Failed to load analytics',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading your analytics...
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Zap className="mx-auto h-12 w-12 opacity-50 mb-2" />
        <p>Could not load analytics</p>
      </div>
    )
  }

  // Prepare donut chart data from top models
  const donutData = stats.topModels?.map(model => ({
    label: model.modelName,
    value: model.count,
    percentage: model.percentage,
  })) || []

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Generations"
          value={stats.totalGenerations.toLocaleString()}
          subtitle="All time"
          icon={Activity}
          accentColor="#f59e0b"
        />
        <StatCard
          title="Images Generated"
          value={stats.totalImages.toLocaleString()}
          subtitle={stats.totalGenerations > 0 
            ? `${Math.round((stats.totalImages / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={ImageIcon}
          accentColor="#3b82f6"
        />
        <StatCard
          title="Videos Generated"
          value={stats.totalVideos.toLocaleString()}
          subtitle={stats.totalGenerations > 0 
            ? `${Math.round((stats.totalVideos / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={Video}
          accentColor="#8b5cf6"
        />
        {isAdmin && spending && (
          <StatCard
            title="Total Spent"
            value={`$${spending.totalCost.toFixed(2)}`}
            subtitle="All time cost"
            icon={DollarSign}
            accentColor="#10b981"
          />
        )}
        {!isAdmin && (
          <StatCard
            title="Models Used"
            value={stats.topModels?.length || 0}
            subtitle="Different AI models"
            icon={Layers}
            accentColor="#10b981"
          />
        )}
      </div>

      {/* Usage Distribution + Model Cards */}
      {stats.topModels && stats.topModels.length > 0 && stats.totalGenerations > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Donut Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                Usage Distribution
              </CardTitle>
              <CardDescription>
                Breakdown of your generations by model
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart
                data={donutData}
                total={stats.totalGenerations}
                centerLabel="Total"
                centerValue={stats.totalGenerations.toLocaleString()}
              />
            </CardContent>
          </Card>

          {/* Model Cards Grid */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
                Usage by Model
              </CardTitle>
              <CardDescription>
                Top models with job counts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.topModels.slice(0, 4).map((model, index) => (
                <ModelUsageCard
                  key={model.modelId}
                  name={model.modelName}
                  jobs={model.count}
                  percentage={model.percentage}
                  color={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Spending Breakdown (Admin Only) */}
      {isAdmin && spending && spending.providerBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              Spending by Provider
            </CardTitle>
            <CardDescription>
              Cost breakdown across AI providers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {spending.providerBreakdown.map((provider, index) => (
                <ColoredProgressBar
                  key={provider.provider}
                  label={provider.provider}
                  value={parseFloat(provider.totalCost.toFixed(2))}
                  percentage={(provider.totalCost / spending.totalCost) * 100}
                  color={CHART_COLORS[index % CHART_COLORS.length]}
                  valueLabel={`($${provider.totalCost.toFixed(2)})`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {(!stats.topModels || stats.topModels.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Zap className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No generations yet</h3>
            <p className="text-muted-foreground max-w-md">
              Start generating images and videos to see your usage statistics here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function GlobalAnalyticsContent() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<GlobalUsageStats | null>(null)
  const [eventStats, setEventStats] = useState<EventStats | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisProcessorStatus | null>(null)
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const refreshAnalysisStatus = async () => {
    try {
      setStatusBusy(true)
      const [processorRes, backfillRes] = await Promise.all([
        fetch('/api/analyze/process'),
        fetch('/api/admin/analysis/backfill'),
      ])

      if (processorRes.ok) {
        const data: AnalysisProcessorStatus = await processorRes.json()
        setAnalysisStatus(data)
      } else {
        const txt = await processorRes.text().catch(() => '')
        throw new Error(`Failed to load analysis status (${processorRes.status}): ${txt}`)
      }

      if (backfillRes.ok) {
        const data: BackfillStatus = await backfillRes.json()
        setBackfillStatus(data)
      } else {
        const txt = await backfillRes.text().catch(() => '')
        throw new Error(`Failed to load backfill status (${backfillRes.status}): ${txt}`)
      }
    } finally {
      setStatusBusy(false)
    }
  }

  const enqueueBackfillBatch = async () => {
    try {
      setBackfillBusy(true)
      const res = await fetch('/api/admin/analysis/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 200 }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Backfill failed (${res.status}): ${txt}`)
      }

      toast({
        title: 'Backfill enqueued',
        description: 'Queued more outputs for semantic analysis.',
      })

      await refreshAnalysisStatus()
    } catch (error: unknown) {
      const err = error as Error
      console.error('Backfill error:', error)
      toast({
        title: 'Backfill failed',
        description: err.message || 'Could not enqueue backfill.',
        variant: 'destructive',
      })
    } finally {
      setBackfillBusy(false)
    }
  }

  const processNextBatch = async () => {
    try {
      setAnalysisBusy(true)
      const res = await fetch('/api/analyze/process', { method: 'POST' })

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Process failed (${res.status}): ${txt}`)
      }

      const result = await res.json()

      if (result.processed !== undefined) {
        toast({
          title: 'Processed batch',
          description: `Processed ${result.processed ?? 0} item(s). Completed: ${result.completed ?? 0}, Failed: ${result.failed ?? 0}.`,
        })
      } else {
        toast({
          title: 'Processing started',
          description: `Started processing ${result.claimed ?? 0} item(s) in the background. Processing will continue even if you navigate away.`,
        })
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
      await refreshAnalysisStatus()
    } catch (error: unknown) {
      const err = error as Error
      console.error('Process error:', error)
      toast({
        title: 'Processing failed',
        description: err.message || 'Could not process analysis queue.',
        variant: 'destructive',
      })
    } finally {
      setAnalysisBusy(false)
    }
  }

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)
        
        // Fetch global usage stats and event stats in parallel
        const [usageResponse, eventResponse] = await Promise.all([
          fetch('/api/analytics/global/usage'),
          fetch('/api/analytics/global/events'),
        ])

        if (usageResponse.ok) {
          const data = await usageResponse.json()
          setStats(data)
        }

        if (eventResponse.ok) {
          const data = await eventResponse.json()
          setEventStats(data)
        }

        // Check if admin and load analysis status
        const profileResponse = await fetch('/api/profile')
        if (profileResponse.ok) {
          const profile = await profileResponse.json()
          setIsAdmin(profile.role === 'admin')

          if (profile.role === 'admin') {
            await refreshAnalysisStatus().catch((e) => {
              console.warn('Failed to load analysis status:', e?.message || e)
            })
          }
        }
      } catch (error) {
        console.error('Error fetching global stats:', error)
        toast({
          title: 'Error',
          description: 'Failed to load global analytics',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading global analytics...
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Globe className="mx-auto h-12 w-12 opacity-50 mb-2" />
        <p>Could not load global analytics</p>
      </div>
    )
  }

  // K-anonymity gate: not enough data yet
  if (!stats.available) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Not Enough Data Yet</h3>
          <p className="text-muted-foreground mb-4 max-w-md">
            {stats.message || 'Global analytics require more active users to ensure privacy.'}
          </p>
          {stats.cohort && (
            <p className="text-sm text-muted-foreground">
              {stats.cohort.uniqueUsers} of {stats.cohort.minUsersRequired} required users
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  // Prepare donut chart data
  const donutData = stats.topModels?.map(model => ({
    label: model.modelName,
    value: model.count,
    percentage: model.percentage,
  })) || []

  return (
    <div className="space-y-6">
      {/* Privacy Notice */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Global statistics are aggregated and anonymized. No individual prompts, outputs, or user data are shown.
          </p>
        </CardContent>
      </Card>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Generations"
          value={(stats.totalGenerations || 0).toLocaleString()}
          subtitle="All users combined"
          icon={Activity}
          accentColor="#f59e0b"
        />
        <StatCard
          title="Images Generated"
          value={(stats.totalImages || 0).toLocaleString()}
          subtitle={stats.totalGenerations && stats.totalGenerations > 0 
            ? `${Math.round((stats.totalImages! / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={ImageIcon}
          accentColor="#3b82f6"
        />
        <StatCard
          title="Videos Generated"
          value={(stats.totalVideos || 0).toLocaleString()}
          subtitle={stats.totalGenerations && stats.totalGenerations > 0 
            ? `${Math.round((stats.totalVideos! / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={Video}
          accentColor="#8b5cf6"
        />
        <StatCard
          title="Active Users"
          value={stats.cohort?.uniqueUsers || 0}
          subtitle="Contributing to analytics"
          icon={Users}
          accentColor="#10b981"
        />
      </div>

      {/* Usage Distribution + Model Cards */}
      {stats.topModels && stats.topModels.length > 0 && (stats.totalGenerations || 0) > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Donut Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                Usage Distribution
              </CardTitle>
              <CardDescription>
                Breakdown of generations by model across all users
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart
                data={donutData}
                total={stats.totalGenerations || 0}
                centerLabel="Total"
                centerValue={(stats.totalGenerations || 0).toLocaleString()}
              />
            </CardContent>
          </Card>

          {/* Model Cards Grid */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-muted-foreground" />
                Usage by Model
              </CardTitle>
              <CardDescription>
                Top models with job counts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.topModels.slice(0, 4).map((model, index) => (
                <ModelUsageCard
                  key={model.modelId}
                  name={model.modelName}
                  jobs={model.count}
                  percentage={model.percentage}
                  color={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Download Statistics - Quality Signal */}
      {eventStats?.available && eventStats.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-muted-foreground" />
              Quality Signals (Downloads)
            </CardTitle>
            <CardDescription>
              Download activity indicates which model/prompt combinations produce outputs users value enough to save
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary Stats */}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold">{eventStats.summary.totalDownloads.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Downloads</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold">{eventStats.summary.totalOutputsWithDownloads.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Unique Outputs Downloaded</div>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <div className="text-2xl font-bold">{eventStats.summary.overallDownloadRate.toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground">Overall Download Rate</div>
              </div>
            </div>

            {/* Top Models by Download Rate */}
            {eventStats.byDownloadRate && eventStats.byDownloadRate.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Models by Download Rate (Quality Signal)
                </h4>
                <div className="space-y-2">
                  {eventStats.byDownloadRate.slice(0, 5).map((model, index) => (
                    <div key={model.modelId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-2.5 h-2.5 rounded-full" 
                            style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                          />
                          <span className="font-medium">{model.modelName}</span>
                          <span className="text-xs text-muted-foreground">({model.provider})</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span className="text-xs">{model.downloadCount} downloads</span>
                          <span className="font-semibold text-foreground">{model.downloadRate.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ 
                            width: `${Math.min(model.downloadRate, 100)}%`, 
                            backgroundColor: CHART_COLORS[index % CHART_COLORS.length] 
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Higher download rates suggest these models produce outputs users find valuable
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Semantic Analysis Controls (Admin Only) */}
      {isAdmin && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-muted-foreground" />
              {"Semantic Analysis (Gemini \u2192 Claude)"}
            </CardTitle>
            <CardDescription>
              {"Enqueue and process output descriptions. This powers future \"what works\" insights. Costs apply."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                {statusBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {"Refreshing status\u2026"}
                  </span>
                ) : (
                  <span>
                    {analysisStatus?.total
                      ? `Outputs: ${analysisStatus.total.outputs.toLocaleString()} \u2022 Completed: ${analysisStatus.total.analyzed.toLocaleString()} \u2022 Pending: ${analysisStatus.total.pending.toLocaleString()}`
                      : 'Status not loaded yet.'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={refreshAnalysisStatus}
                  disabled={statusBusy || analysisBusy || backfillBusy}
                >
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  onClick={enqueueBackfillBatch}
                  disabled={statusBusy || analysisBusy || backfillBusy}
                >
                  {backfillBusy ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Layers className="h-4 w-4 mr-2" />
                  )}
                  Backfill (200)
                </Button>
                <Button
                  onClick={processNextBatch}
                  disabled={statusBusy || analysisBusy || backfillBusy}
                >
                  {analysisBusy ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Process batch
                </Button>
              </div>
            </div>

            {/* Progress bars */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-muted/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Coverage</CardTitle>
                  <CardDescription>
                    Outputs with analysis records enqueued
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Enqueued</span>
                    <span className="font-semibold">
                      {backfillStatus
                        ? `${backfillStatus.analysis.total.toLocaleString()} / ${backfillStatus.totalOutputs.toLocaleString()}`
                        : '\u2014'}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: backfillStatus ? `${Math.min(backfillStatus.percentComplete, 100)}%` : '0%',
                      }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {backfillStatus
                      ? `${backfillStatus.percentComplete}% enqueued \u2022 Missing: ${backfillStatus.pendingBackfill.toLocaleString()}`
                      : '\u2014'}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-muted/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Processing</CardTitle>
                  <CardDescription>
                    Completed Gemini captions + Claude parsing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Completed</span>
                    <span className="font-semibold">
                      {analysisStatus?.total
                        ? `${analysisStatus.total.analyzed.toLocaleString()} / ${analysisStatus.total.outputs.toLocaleString()}`
                        : '\u2014'}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{
                        width: analysisStatus?.total && analysisStatus.total.outputs > 0
                          ? `${Math.min((analysisStatus.total.analyzed / analysisStatus.total.outputs) * 100, 100)}%`
                          : '0%',
                      }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {analysisStatus?.queue
                      ? `Queued: ${(analysisStatus.queue.queued || 0).toLocaleString()} \u2022 Processing: ${(analysisStatus.queue.processing || 0).toLocaleString()} \u2022 Failed: ${(analysisStatus.queue.failed || 0).toLocaleString()}`
                      : '\u2014'}
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('my')

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          Understand your generation patterns and see how they compare globally
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="my" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            My
          </TabsTrigger>
          <TabsTrigger value="global" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Global
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my" className="mt-6">
          <MyAnalyticsContent />
        </TabsContent>

        <TabsContent value="global" className="mt-6">
          <GlobalAnalyticsContent />
        </TabsContent>
      </Tabs>
    </div>
  )
}
