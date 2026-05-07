'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCmfActivity, type CmfActivityItem } from '@/hooks/useCmfCollab'
import { CmfPersonAvatar } from './CmfPersonAvatar'
import {
  Activity,
  Database,
  FileText,
  History,
  Loader2,
  MessageSquare,
  ShieldCheck,
  UserPlus,
  Wand2,
  AlertTriangle,
} from 'lucide-react'

interface CmfActivityDrawerProps {
  packetId: string | null
}

/**
 * Activity feed surface — tucked behind a small "History" button next to
 * the packet header. Shown as a dialog rather than a side panel so it
 * doesn't compete with the pipeline spine for screen real estate.
 */
export function CmfActivityDrawer({ packetId }: CmfActivityDrawerProps) {
  const [open, setOpen] = useState(false)
  const { data: items, isLoading } = useCmfActivity(open ? packetId : null)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!packetId}
        className="gap-1.5"
      >
        <History className="h-3.5 w-3.5" />
        History
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription>
              Every meaningful event on this packet — imports, renders,
              comments, and member changes — newest first.
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}

          {!isLoading && (!items || items.length === 0) && (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          )}

          <ol className="space-y-2 max-h-[60vh] overflow-y-auto">
            {items?.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ActivityIconConfig {
  Icon: React.ComponentType<{ className?: string }>
  copy: (item: CmfActivityItem) => string
  tone: 'primary' | 'amber' | 'destructive' | 'muted'
}

const ACTION_MAP: Record<string, ActivityIconConfig> = {
  created_packet: {
    Icon: Activity,
    copy: () => 'created the packet',
    tone: 'primary',
  },
  imported_workbook: {
    Icon: Database,
    copy: (item) => {
      const meta = item.metadata as { rows?: number; errors?: number } | null
      const rows = meta?.rows ?? 0
      const errs = meta?.errors ?? 0
      return `imported ${rows} ${rows === 1 ? 'row' : 'rows'}${errs ? ` · ${errs} errors` : ''}`
    },
    tone: 'primary',
  },
  edited_sku: {
    Icon: Activity,
    copy: (item) => {
      const meta = item.metadata as { fields?: string[] } | null
      const fields = meta?.fields ?? []
      return fields.length > 0
        ? `edited SKU · ${fields.slice(0, 3).join(', ')}`
        : 'edited a SKU'
    },
    tone: 'muted',
  },
  rendered_sku: {
    Icon: Wand2,
    copy: (item) => {
      const meta = item.metadata as { label?: string } | null
      return meta?.label ? `rendered "${meta.label}"` : 'rendered a SKU'
    },
    tone: 'primary',
  },
  render_failed: {
    Icon: AlertTriangle,
    copy: (item) => {
      const meta = item.metadata as { message?: string } | null
      return meta?.message ? `render failed: ${meta.message}` : 'a render failed'
    },
    tone: 'destructive',
  },
  pdf_generated: {
    Icon: FileText,
    copy: () => 'generated the packet PDF',
    tone: 'primary',
  },
  pdf_failed: {
    Icon: AlertTriangle,
    copy: () => 'PDF generation failed',
    tone: 'destructive',
  },
  commented: {
    Icon: MessageSquare,
    copy: (item) => {
      const meta = item.metadata as { renderId?: string | null } | null
      return meta?.renderId ? 'left a comment on a SKU' : 'left a comment on the packet'
    },
    tone: 'muted',
  },
  comment_resolved: {
    Icon: ShieldCheck,
    copy: () => 'resolved a comment',
    tone: 'primary',
  },
  invited_member: {
    Icon: UserPlus,
    copy: (item) => {
      const meta = item.metadata as { role?: string; username?: string | null } | null
      return meta?.username
        ? `invited @${meta.username} as ${meta.role ?? 'editor'}`
        : `invited a member as ${meta?.role ?? 'editor'}`
    },
    tone: 'primary',
  },
  role_changed: {
    Icon: ShieldCheck,
    copy: (item) => {
      const meta = item.metadata as { from?: string; to?: string } | null
      return meta?.from && meta?.to
        ? `changed a role from ${meta.from} to ${meta.to}`
        : 'changed a member role'
    },
    tone: 'muted',
  },
  removed_member: {
    Icon: UserPlus,
    copy: (item) => {
      const meta = item.metadata as { selfRemoval?: boolean } | null
      return meta?.selfRemoval ? 'left the packet' : 'removed a member'
    },
    tone: 'muted',
  },
}

const FALLBACK: ActivityIconConfig = {
  Icon: Activity,
  copy: (item) => item.action,
  tone: 'muted',
}

function ActivityRow({ item }: { item: CmfActivityItem }) {
  const config = ACTION_MAP[item.action] ?? FALLBACK
  const { Icon } = config
  const toneClass =
    config.tone === 'primary'
      ? 'text-primary'
      : config.tone === 'amber'
      ? 'text-amber-600 dark:text-amber-300'
      : config.tone === 'destructive'
      ? 'text-destructive'
      : 'text-muted-foreground/80'

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/30 bg-card/30 px-3 py-2.5">
      <CmfPersonAvatar person={item.user} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 text-xs">
        <p className="leading-snug">
          <span className="font-medium text-foreground">
            {item.user.displayName ?? item.user.username ?? 'Someone'}
          </span>{' '}
          <span className={toneClass}>{config.copy(item)}</span>
        </p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-0.5">
          {new Date(item.createdAt).toLocaleString()}
        </p>
      </div>
      <Icon className={`h-3.5 w-3.5 mt-1 flex-shrink-0 ${toneClass}`} />
    </li>
  )
}
