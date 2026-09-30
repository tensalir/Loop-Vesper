'use client'

/**
 * Small pieces every CMF Studio tab uses: a panel, a labelled picker, the key state, who made a
 * render and through which door, a refusal in the service's own words, and short dates and hashes.
 */

import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CmfRequestError, type CmfKeyState } from '@/hooks/useCmf'

export function Panel({ title, hint, actions, children, className }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border/50 bg-card/25 p-4 md:p-5 space-y-3', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {hint && <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">{hint}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  label: string
  value: T | ''
  options: Array<{ value: T; label: string; disabled?: boolean }>
  onChange: (v: T) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground min-w-[10rem]">
      <span className="font-medium uppercase tracking-wider text-[10px]">{label}</span>
      <select
        className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm text-foreground disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A key's state as the kit has it: a draft, confirmed by Damien, or named and not yet confirmed. */
export function keyStateLabel(k: Pick<CmfKeyState, 'draft' | 'confirmed'>): string {
  return k.draft ? 'draft' : k.confirmed ? 'confirmed' : 'not confirmed yet'
}

export function KeyState({ keyState }: { keyState: Pick<CmfKeyState, 'draft' | 'confirmed'> }) {
  const tone = keyState.draft
    ? 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
    : keyState.confirmed
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : 'border-border/60 bg-muted/40 text-muted-foreground'
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider', tone)}>{keyStateLabel(keyState)}</span>
}

export const DOOR_NAME: Record<string, string> = { mcp: 'Claude', web: 'CMF Studio' }

export function Door({ door }: { door: string | null }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/50 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {door ? `made in ${DOOR_NAME[door] ?? door}` : 'door unknown'}
    </span>
  )
}

export function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 12) : '')

/** A grade's outcome in plain words. */
export function gradeWords(verdict: string | null | undefined): string {
  switch (verdict) {
    case 'PASS':
      return 'Pass'
    case 'PASS_WITH_NOTES':
      return 'Pass with notes'
    case 'RETRY':
      return 'Try again'
    case 'FAIL':
      return 'Fail'
    default:
      return verdict ?? 'No grade'
  }
}

/** A refusal, in the service's words (they are what Claude is told too), and any reasons or rows it came with. */
export function Refusal({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  const body = error instanceof CmfRequestError ? error.body : {}
  const reasons = Array.isArray(body.reasons) ? (body.reasons as string[]) : []
  const rows = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : []
  return (
    <div className={cn('rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-100 space-y-2', className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <p className="whitespace-pre-wrap leading-relaxed">{message}</p>
      </div>
      {reasons.length > 0 && !message.includes(reasons[0]) && (
        <ul className="list-disc pl-6 space-y-0.5">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {rows.length > 0 && <CheckRows rows={rows} />}
    </div>
  )
}

/** The rows of a check that are not their cell. */
export function CheckRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pr-3 font-medium">Column</th>
            <th className="py-1 pr-3 font-medium">Component</th>
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Sheet</th>
            <th className="py-1 pr-3 font-medium">PDF</th>
            <th className="py-1 pr-3 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/30 align-top">
              <td className="py-1 pr-3 font-mono">{String(r.column ?? '')}</td>
              <td className="py-1 pr-3">{String(r.component ?? '')}</td>
              <td className="py-1 pr-3">{String(r.field ?? '')}</td>
              <td className="py-1 pr-3">{String(r.sheet ?? '')}</td>
              <td className="py-1 pr-3">{String(r.pdf ?? '')}</td>
              <td className="py-1 pr-3">
                {String(r.state ?? '').replace(/_/g, ' ')}
                {r.cause ? ` (${String(r.cause)})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border/50 bg-card/10 p-6 text-center text-sm text-muted-foreground">{children}</p>
}
