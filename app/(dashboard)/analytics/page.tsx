'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

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

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon 
}: { 
  title: string
  value: string | number
  subtitle?: string
  icon: React.ElementType
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

function ProgressBar({ 
  label, 
  value, 
  percentage, 
  rank 
}: { 
  label: string
  value: number
  percentage: number
  rank?: number
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {rank !== undefined && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {rank}
            </div>
          )}
          <span className="font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{value.toLocaleString()} generations</span>
          <span className="text-xs">({percentage.toFixed(1)}%)</span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  )
}

function MyAnalyticsContent() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<MyUsageStats | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/analytics/usage')
        if (response.ok) {
          const data = await response.json()
          setStats(data)
        }
      } catch (error) {
        console.error('Error fetching my stats:', error)
        toast({
          title: 'Error',
          description: 'Failed to load your analytics',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
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

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total Generations"
          value={stats.totalGenerations}
          subtitle="All time"
          icon={Activity}
        />
        <StatCard
          title="Images Generated"
          value={stats.totalImages}
          subtitle={stats.totalGenerations > 0 
            ? `${Math.round((stats.totalImages / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={ImageIcon}
        />
        <StatCard
          title="Videos Generated"
          value={stats.totalVideos}
          subtitle={stats.totalGenerations > 0 
            ? `${Math.round((stats.totalVideos / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={Video}
        />
      </div>

      {/* Provider & Type Breakdown */}
      {(stats.byProvider?.length || stats.byType?.length) && stats.totalGenerations > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Provider Breakdown */}
          {stats.byProvider && stats.byProvider.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By Provider</CardTitle>
                <CardDescription>
                  Your generation distribution across AI providers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.byProvider.map((provider) => (
                    <ProgressBar
                      key={provider.provider}
                      label={provider.provider}
                      value={provider.count}
                      percentage={provider.percentage}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Type Breakdown */}
          {stats.byType && stats.byType.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By Media Type</CardTitle>
                <CardDescription>
                  Images vs videos you've generated
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.byType.map((type) => (
                    <ProgressBar
                      key={type.type}
                      label={type.type === 'image' ? 'Images' : 'Videos'}
                      value={type.count}
                      percentage={type.percentage}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Top Models */}
      <Card>
        <CardHeader>
          <CardTitle>Your Most Used Models</CardTitle>
          <CardDescription>
            Your generation activity by AI model
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topModels && stats.topModels.length > 0 ? (
            <div className="space-y-4">
              {stats.topModels.map((model, index) => (
                <div key={model.modelId} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </div>
                      <div>
                        <span className="font-medium">{model.modelName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {model.provider} · {model.type}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{model.count.toLocaleString()} generations</span>
                      <span className="text-xs">({model.percentage.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min(model.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <Zap className="mx-auto h-12 w-12 opacity-50 mb-2" />
              <p>No generations yet</p>
              <p className="text-sm">Start generating to see your usage statistics</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function GlobalAnalyticsContent() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<GlobalUsageStats | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/analytics/global/usage')
        if (response.ok) {
          const data = await response.json()
          setStats(data)
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
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Generations"
          value={stats.totalGenerations?.toLocaleString() || 0}
          subtitle="All users combined"
          icon={Activity}
        />
        <StatCard
          title="Images Generated"
          value={stats.totalImages?.toLocaleString() || 0}
          subtitle={stats.totalGenerations && stats.totalGenerations > 0 
            ? `${Math.round((stats.totalImages! / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={ImageIcon}
        />
        <StatCard
          title="Videos Generated"
          value={stats.totalVideos?.toLocaleString() || 0}
          subtitle={stats.totalGenerations && stats.totalGenerations > 0 
            ? `${Math.round((stats.totalVideos! / stats.totalGenerations) * 100)}% of total`
            : '0% of total'}
          icon={Video}
        />
        <StatCard
          title="Active Users"
          value={stats.cohort?.uniqueUsers || 0}
          subtitle="Contributing to analytics"
          icon={Users}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Provider Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>By Provider</CardTitle>
            <CardDescription>
              Generation distribution across AI providers
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.byProvider && stats.byProvider.length > 0 ? (
              <div className="space-y-4">
                {stats.byProvider.map((provider) => (
                  <ProgressBar
                    key={provider.provider}
                    label={provider.provider}
                    value={provider.count}
                    percentage={provider.percentage}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p>No provider data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>By Media Type</CardTitle>
            <CardDescription>
              Images vs videos generated
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.byType && stats.byType.length > 0 ? (
              <div className="space-y-4">
                {stats.byType.map((type) => (
                  <ProgressBar
                    key={type.type}
                    label={type.type === 'image' ? 'Images' : 'Videos'}
                    value={type.count}
                    percentage={type.percentage}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <p>No type data available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Models */}
      <Card>
        <CardHeader>
          <CardTitle>Most Used Models</CardTitle>
          <CardDescription>
            Popular AI models across all users
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topModels && stats.topModels.length > 0 ? (
            <div className="space-y-4">
              {stats.topModels.map((model, index) => (
                <div key={model.modelId} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </div>
                      <div>
                        <span className="font-medium">{model.modelName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {model.provider} · {model.type}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{model.count.toLocaleString()} generations</span>
                      <span className="text-xs">({model.percentage.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min(model.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <Zap className="mx-auto h-12 w-12 opacity-50 mb-2" />
              <p>No model data available</p>
            </div>
          )}
        </CardContent>
      </Card>
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

