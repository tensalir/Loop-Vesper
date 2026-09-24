'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Plug } from 'lucide-react'

interface ConnectedApp {
  id: string
  name: string
  clientName: string | null
  clientKey: string | null
  subjectEmail: string | null
  createdAt: string
  lastUsedAt: string | null
}

/**
 * The apps this person connected to Vesper with their own sign-in (Claude,
 * Claude Code). Disconnecting revokes the connection and its tokens at once.
 */
export function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/connected-apps')
      if (!res.ok) throw new Error('Could not load your connected apps')
      const data = (await res.json()) as { apps: ConnectedApp[] }
      setApps(data.apps)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your connected apps')
      setApps([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const disconnect = async (app: ConnectedApp) => {
    setBusy(app.id)
    setError('')
    try {
      const res = await fetch(`/api/me/connected-apps?id=${encodeURIComponent(app.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not disconnect it')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect it')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          Connected apps
        </CardTitle>
        <CardDescription>
          Apps you connected to Vesper with your own sign-in, such as Claude. They act as you. Disconnect one and it
          must sign in again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {apps === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. In Claude, add Vesper under Connectors and click Connect.
          </p>
        ) : (
          apps.map((app) => (
            <div key={app.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{app.clientName || app.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {app.clientKey ?? 'unknown'} · connected {new Date(app.createdAt).toLocaleDateString()}
                  {app.lastUsedAt ? ` · last used ${new Date(app.lastUsedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => disconnect(app)} disabled={busy === app.id}>
                {busy === app.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
              </Button>
            </div>
          ))
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
