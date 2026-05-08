'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  useCmfClowns,
  useUploadClown,
  useUploadClownsBulk,
  type CmfClownAsset,
  type CmfClownBulkResult,
} from '@/hooks/useCmf'
import { listCmfProducts } from '@/lib/cmf/products'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  Loader2,
  Upload,
  ImageIcon,
  Search,
  X,
  Plus,
  Archive,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'

interface CmfClownLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Optional: if set, the grid surfaces a "Use" affordance per thumbnail
   * that calls back with the picked asset. Used by render rows that want
   * to reach into the shared library and pick a reference for one SKU.
   */
  onSelectAsset?: (asset: CmfClownAsset) => void
}

/**
 * Shared workspace clown library.
 *
 * Modelled on `ProductRendersBrowseModal` so designers see the same
 * filtering grammar (chips by category, searchable label, big square
 * thumbnails) they already know from the prompt-bar product browser.
 *
 * Two upload paths live behind a single "+ Add" affordance:
 *   1. Single PNG — for one-offs and edits.
 *   2. Bulk zip   — drag-drop the canonical "Clown Renders" zip pack and
 *      let the server map each entry to the right product/variant.
 */
export function CmfClownLibraryDialog({
  open,
  onOpenChange,
  onSelectAsset,
}: CmfClownLibraryDialogProps) {
  const products = useMemo(() => listCmfProducts(), [])
  const { data: clowns, isLoading, isFetching } = useCmfClowns()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  // Group products into the rows the rest of the app already uses.
  const groupedProducts = useMemo(() => {
    const earplugs = products.filter((p) => p.category === 'earplug')
    const cases = products.filter((p) => p.category === 'case')
    const sensewear = products.filter((p) => p.category === 'sensewear')
    return { earplugs, cases, sensewear }
  }, [products])

  // Filter clowns by search + product chip.
  const visibleClowns = useMemo(() => {
    if (!clowns) return []
    const needle = search.trim().toLowerCase()
    return clowns.filter((c) => {
      if (productFilter && c.productSlug !== productFilter) return false
      if (!needle) return true
      const haystack = `${c.label} ${c.productSlug} ${c.variantSlug}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [clowns, search, productFilter])

  // Group filtered clowns by product, in the canonical catalog order so
  // earplugs land above cases regardless of what the DB returns.
  const groupedClowns = useMemo(() => {
    const map = new Map<string, CmfClownAsset[]>()
    for (const clown of visibleClowns) {
      const arr = map.get(clown.productSlug) ?? []
      arr.push(clown)
      map.set(clown.productSlug, arr)
    }
    const orderedSlugs = products
      .map((p) => p.slug)
      .filter((slug) => map.has(slug))
    // Anything not in the catalog (defensive) sorts to the end alphabetically.
    const orphanSlugs = Array.from(map.keys())
      .filter((slug) => !orderedSlugs.includes(slug))
      .sort()
    return [...orderedSlugs, ...orphanSlugs].map((slug) => ({
      slug,
      product: products.find((p) => p.slug === slug),
      assets: (map.get(slug) ?? []).sort((a, b) =>
        a.variantSlug.localeCompare(b.variantSlug)
      ),
    }))
  }, [visibleClowns, products])

  const totalCount = clowns?.length ?? 0
  const filteredCount = visibleClowns.length
  const hasFilters = Boolean(search || productFilter)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="flex items-center gap-2">
                Clown reference library
                {isFetching && !isLoading && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Shared across the workspace. Each clown PNG anchors the geometry
                of one product+variant; the renderer recolours each region from
                the workbook. Drop the canonical zip pack and the server will
                file every entry into the right slot.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant={uploadOpen ? 'secondary' : 'default'}
              size="sm"
              onClick={() => setUploadOpen((v) => !v)}
              className="gap-1.5 flex-shrink-0"
            >
              {uploadOpen ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  Close upload
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add references
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        {/* Upload sub-panel — collapsed by default */}
        {uploadOpen && (
          <UploadPanel
            onDone={() => setUploadOpen(false)}
            onToast={toast}
          />
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product, variant, or label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Product chips */}
        <div className="space-y-2">
          {hasFilters && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setProductFilter(null)
                }}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            </div>
          )}
          {groupedProducts.earplugs.length > 0 && (
            <ChipRow
              label="Earplugs"
              products={groupedProducts.earplugs}
              activeSlug={productFilter}
              clowns={clowns}
              onToggle={(slug) =>
                setProductFilter(productFilter === slug ? null : slug)
              }
            />
          )}
          {groupedProducts.cases.length > 0 && (
            <ChipRow
              label="Cases & pouches"
              products={groupedProducts.cases}
              activeSlug={productFilter}
              clowns={clowns}
              onToggle={(slug) =>
                setProductFilter(productFilter === slug ? null : slug)
              }
            />
          )}
          {groupedProducts.sensewear.length > 0 && (
            <ChipRow
              label="Sensewear"
              products={groupedProducts.sensewear}
              activeSlug={productFilter}
              clowns={clowns}
              onToggle={(slug) =>
                setProductFilter(productFilter === slug ? null : slug)
              }
            />
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : totalCount === 0 ? (
            <EmptyHero onUpload={() => setUploadOpen(true)} />
          ) : filteredCount === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <p className="text-sm">No references match those filters.</p>
            </div>
          ) : (
            <div className="space-y-6 pb-2">
              {groupedClowns.map(({ slug, product, assets }, idx) => (
                <div key={slug}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
                      {product?.name ?? slug}
                    </div>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">
                      {assets.length} {assets.length === 1 ? 'reference' : 'references'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                    {assets.map((asset) => (
                      <ClownThumb
                        key={asset.id}
                        asset={asset}
                        onSelect={onSelectAsset}
                      />
                    ))}
                  </div>
                  {idx < groupedClowns.length - 1 && (
                    <div className="mt-6 h-px bg-border" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer count */}
        <div className="text-[11px] text-muted-foreground/70 font-mono uppercase tracking-wider pt-1 border-t border-border/40">
          {totalCount === 0
            ? 'Library empty'
            : hasFilters
            ? `${filteredCount} of ${totalCount} shown`
            : `${totalCount} ${totalCount === 1 ? 'reference' : 'references'} · ${groupedClowns.length} ${groupedClowns.length === 1 ? 'product' : 'products'}`}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─── chip row ─────────────────────────────────────────────────────────── */

function ChipRow({
  label,
  products,
  activeSlug,
  clowns,
  onToggle,
}: {
  label: string
  products: ReturnType<typeof listCmfProducts>
  activeSlug: string | null
  clowns: CmfClownAsset[] | undefined
  onToggle: (slug: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-32">
        {label}:
      </span>
      {products.map((p) => {
        const count = clowns?.filter((c) => c.productSlug === p.slug).length ?? 0
        const isActive = activeSlug === p.slug
        return (
          <Button
            key={p.slug}
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            onClick={() => onToggle(p.slug)}
            className="h-7 text-xs gap-1.5"
          >
            {p.name}
            {count > 0 && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-1.5 text-[10px] font-medium',
                  isActive ? 'bg-primary-foreground/20' : 'bg-muted'
                )}
              >
                {count}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}

/* ─── thumbnail ────────────────────────────────────────────────────────── */

function ClownThumb({
  asset,
  onSelect,
}: {
  asset: CmfClownAsset
  onSelect?: (asset: CmfClownAsset) => void
}) {
  const interactive = Boolean(onSelect)
  return (
    <div
      className={cn(
        'group relative rounded-lg overflow-hidden border border-border/40 bg-background/40',
        interactive && 'cursor-pointer hover:border-primary/60 transition-colors'
      )}
      onClick={() => onSelect?.(asset)}
      role={interactive ? 'button' : undefined}
    >
      <div className="aspect-square bg-black/30 flex items-center justify-center">
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.imageUrl}
            alt={asset.label}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-[11px] font-medium truncate">{asset.label}</p>
        <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider truncate">
          {asset.productSlug} · {asset.variantSlug}
        </p>
      </div>
      {interactive && (
        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 pointer-events-none transition-colors">
          <div className="absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="rounded-md bg-primary text-primary-foreground text-[10px] font-medium uppercase tracking-wider text-center py-1">
              Use
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── empty hero ───────────────────────────────────────────────────────── */

function EmptyHero({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-center space-y-4 py-8">
      <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <ImageIcon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">No references uploaded yet</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          Drop the canonical &ldquo;Clown Renders&rdquo; zip pack and Vesper
          will file every PNG into the right product slot.
        </p>
      </div>
      <Button onClick={onUpload} size="sm" className="gap-1.5">
        <Upload className="h-3.5 w-3.5" />
        Upload references
      </Button>
    </div>
  )
}

/* ─── upload sub-panel ─────────────────────────────────────────────────── */

function UploadPanel({
  onDone,
  onToast,
}: {
  onDone: () => void
  onToast: (args: { title: string; description?: string }) => void
}) {
  return (
    <div
      className="rounded-xl border border-border/50 bg-card/30 p-4"
      style={{
        backgroundImage:
          'radial-gradient(50% 80% at 0% 0%, color-mix(in oklch, hsl(var(--primary)) 6%, transparent), transparent 70%)',
      }}
    >
      <Tabs defaultValue="bulk" className="w-full">
        <TabsList className="mb-3">
          <TabsTrigger value="bulk" className="gap-1.5 text-xs">
            <Archive className="h-3.5 w-3.5" />
            Bulk zip
          </TabsTrigger>
          <TabsTrigger value="single" className="gap-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" />
            Single PNG
          </TabsTrigger>
        </TabsList>
        <TabsContent value="bulk">
          <BulkUploadForm onDone={onDone} onToast={onToast} />
        </TabsContent>
        <TabsContent value="single">
          <SingleUploadForm onDone={onDone} onToast={onToast} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BulkUploadForm({
  onDone,
  onToast,
}: {
  onDone: () => void
  onToast: (args: { title: string; description?: string }) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [lastReport, setLastReport] = useState<{
    summary: { uploaded: number; replaced: number; skipped: number; total: number }
    results: CmfClownBulkResult[]
  } | null>(null)
  const bulk = useUploadClownsBulk()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0) {
      onToast({ title: 'Pick one or more .zip files first' })
      return
    }
    try {
      const report = await bulk.mutateAsync({ files })
      setLastReport(report)
      const { uploaded, replaced, skipped } = report.summary
      onToast({
        title: 'Bulk upload complete',
        description: `${uploaded} new, ${replaced} replaced, ${skipped} skipped.`,
      })
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (uploaded + replaced > 0 && skipped === 0) {
        onDone()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk upload failed'
      onToast({ title: 'Bulk upload failed', description: message })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Zip files
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        <p className="text-[11px] text-muted-foreground">
          The server uses the canonical zip-name mapping (e.g. <code>switch 2 clown for claude.zip</code>{' '}
          → <code>switch2</code>) and derives variant slugs from each PNG&rsquo;s filename.
          Unknown zips are skipped with a note.
        </p>
      </div>
      {files.length > 0 && (
        <div className="rounded-md border border-border/40 bg-background/40 p-2 space-y-1 max-h-32 overflow-y-auto">
          {files.map((f, i) => (
            <p key={i} className="text-[11px] font-mono text-muted-foreground truncate">
              {f.name} <span className="text-muted-foreground/60">({(f.size / 1024).toFixed(0)} KB)</span>
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={bulk.isPending || files.length === 0}
          className="gap-1.5"
        >
          {bulk.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {bulk.isPending ? 'Uploading…' : `Upload ${files.length || ''} zip${files.length === 1 ? '' : 's'}`}
        </Button>
      </div>
      {lastReport && <BulkReport report={lastReport} />}
    </form>
  )
}

function BulkReport({
  report,
}: {
  report: {
    summary: { uploaded: number; replaced: number; skipped: number; total: number }
    results: CmfClownBulkResult[]
  }
}) {
  const { summary, results } = report
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3 space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1 text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {summary.uploaded} new
        </span>
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {summary.replaced} replaced
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5" />
          {summary.skipped} skipped
        </span>
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {results.map((r, i) => (
          <p
            key={i}
            className={cn(
              'text-[11px] font-mono leading-snug truncate',
              r.status === 'error' && 'text-destructive',
              r.status === 'skipped' && 'text-muted-foreground/70',
              r.status === 'replaced' && 'text-amber-700 dark:text-amber-300',
              r.status === 'uploaded' && 'text-primary'
            )}
            title={r.message}
          >
            [{r.status}] {r.zip} → {r.inner}
            {r.productSlug && ` · ${r.productSlug}/${r.variantSlug}`}
            {r.message && ` · ${r.message}`}
          </p>
        ))}
      </div>
    </div>
  )
}

function SingleUploadForm({
  onDone,
  onToast,
}: {
  onDone: () => void
  onToast: (args: { title: string; description?: string }) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const products = listCmfProducts()
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? 'switch2')
  const [variantSlug, setVariantSlug] = useState('default')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const upload = useUploadClown()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      onToast({ title: 'Pick an image first' })
      return
    }
    if (!label.trim()) {
      onToast({ title: 'Enter a label' })
      return
    }
    try {
      await upload.mutateAsync({
        file,
        productSlug,
        variantSlug: variantSlug || 'default',
        label: label.trim(),
      })
      onToast({ title: 'Reference uploaded' })
      setFile(null)
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      onDone()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      onToast({ title: 'Upload failed', description: message })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Product
        </Label>
        <select
          value={productSlug}
          onChange={(e) => setProductSlug(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Variant slug
        </Label>
        <Input
          value={variantSlug}
          onChange={(e) => setVariantSlug(e.target.value)}
          placeholder="default"
          className="h-9 font-mono text-xs"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Label
        </Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Aphrodite clown 2"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Image (PNG/JPG)
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
      </div>
      <div className="sm:col-span-2 flex items-center justify-end">
        <Button type="submit" size="sm" disabled={upload.isPending} className="gap-1.5">
          {upload.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          Upload reference
        </Button>
      </div>
    </form>
  )
}
