'use client'

/**
 * The CMF Studio: the same CMF steps Claude takes, in the web. Every tab calls the CMF service
 * through `/api/cmf/v2/*` (`src/lib/creative/cmf/web-door.ts`), so a workbook uploaded here can be
 * used in Claude, a render made in Claude is reviewed here, and the other way round.
 *
 *   Workbook   upload the export; its tabs, SKUs by column letter, and each key's state
 *   Render     the exact prompt that will be sent, then the render
 *   Review     the team's renders, their grade, every answer, and a yes or no with why
 *   PDF        the supplier PDF from approved renders, checked against the cells; past PDFs
 *   History    what was made the old way, read only
 *   Clowns and keys   the kit's keys and clowns, read only
 *
 * The open tab and upload are kept in the URL (`?tab=&upload=`), so a link opens the same view.
 */

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CmfRequestError, useCmfListing } from '@/hooks/useCmf'
import { WorkbookTab } from './studio/WorkbookTab'
import { RenderTab } from './studio/RenderTab'
import { ReviewTab } from './studio/ReviewTab'
import { PdfTab } from './studio/PdfTab'
import { HistoryTab } from './studio/HistoryTab'
import { KeysTab } from './studio/KeysTab'
import { Refusal } from './studio/parts'

const TABS = [
  { id: 'workbook', label: 'Workbook' },
  { id: 'render', label: 'Render' },
  { id: 'review', label: 'Review' },
  { id: 'pdf', label: 'PDF' },
  { id: 'history', label: 'History (made the old way)' },
  { id: 'keys', label: 'Clowns and keys' },
] as const
type TabId = (typeof TABS)[number]['id']

export function CmfStudio() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const { data: listing, isLoading, error } = useCmfListing()

  const urlTab = search?.get('tab') as TabId | null
  const [tab, setTab] = useState<TabId>(urlTab && TABS.some((t) => t.id === urlTab) ? urlTab : 'workbook')
  const [importId, setImportId] = useState<string | null>(search?.get('upload') ?? null)

  // The newest upload, until one is picked.
  useEffect(() => {
    if (!importId && listing?.uploads[0]) setImportId(listing.uploads[0].import_id)
  }, [importId, listing])

  const sync = useCallback(
    (next: { tab?: TabId; upload?: string | null }) => {
      const params = new URLSearchParams(search?.toString() ?? '')
      if (next.tab) params.set('tab', next.tab)
      if (next.upload !== undefined) {
        if (next.upload) params.set('upload', next.upload)
        else params.delete('upload')
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, search]
  )

  const noAccess = error instanceof CmfRequestError && (error.status === 403 || error.status === 401)

  return (
    <div className="max-w-[1400px] mx-auto space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">Loop · Product · CMF</p>
          <h1 className="text-2xl font-semibold tracking-tight">CMF Studio</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            The same steps as CMF in Claude, on the same records: what the team makes here or in Claude shows in both.
          </p>
        </div>
        {listing && (
          <span className="rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
            Product kit {listing.kit_tag ?? listing.kit_version}
            {listing.kit_stale ? ' (stale)' : ''}
          </span>
        )}
      </header>

      {isLoading && (
        <div className="rounded-2xl border border-border/50 bg-card/30 p-12 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {noAccess && (
        <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 mt-0.5" />
          <p>{(error as Error).message}</p>
        </div>
      )}
      {error && !noAccess && <Refusal error={error} />}

      {listing && (
        <>
          {listing.problems.length > 0 && (
            <div className="space-y-1">
              {listing.problems.map((p) => (
                <Refusal key={p} error={new Error(`Not listed: ${p}.`)} />
              ))}
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as TabId)
              sync({ tab: v as TabId })
            }}
          >
            <TabsList className="flex-wrap h-auto justify-start">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  {t.id === 'review' && listing.renders.length > 0 ? <span className="ml-1.5 text-[10px] text-muted-foreground">{listing.renders.length}</span> : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="workbook" className="pt-3">
              <WorkbookTab
                listing={listing}
                importId={importId}
                onImportChange={(id) => {
                  setImportId(id)
                  sync({ upload: id })
                }}
              />
            </TabsContent>
            <TabsContent value="render" className="pt-3">
              <RenderTab listing={listing} importId={importId} />
            </TabsContent>
            <TabsContent value="review" className="pt-3">
              <ReviewTab listing={listing} />
            </TabsContent>
            <TabsContent value="pdf" className="pt-3">
              <PdfTab listing={listing} importId={importId} />
            </TabsContent>
            <TabsContent value="history" className="pt-3">
              <HistoryTab />
            </TabsContent>
            <TabsContent value="keys" className="pt-3">
              <KeysTab />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
