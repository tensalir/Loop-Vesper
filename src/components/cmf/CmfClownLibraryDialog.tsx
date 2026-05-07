'use client'

import { useRef, useState } from 'react'
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
import { useCmfClowns, useUploadClown } from '@/hooks/useCmf'
import { listCmfProducts } from '@/lib/cmf/products'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Upload, ImageIcon } from 'lucide-react'

interface CmfClownLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CmfClownLibraryDialog({
  open,
  onOpenChange,
}: CmfClownLibraryDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const products = listCmfProducts()
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? 'switch2')
  const [variantSlug, setVariantSlug] = useState('default')
  const [label, setLabel] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const { data: clowns, isLoading } = useCmfClowns()
  const uploadMutation = useUploadClown()
  const { toast } = useToast()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast({ title: 'Pick an image first' })
      return
    }
    if (!label.trim()) {
      toast({ title: 'Enter a label' })
      return
    }
    try {
      await uploadMutation.mutateAsync({
        file,
        productSlug,
        variantSlug: variantSlug || 'default',
        label: label.trim(),
      })
      toast({ title: 'Clown uploaded' })
      setFile(null)
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      toast({ title: 'Upload failed', description: message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clown reference library</DialogTitle>
          <DialogDescription>
            Upload the colour-coded clown PNG for each product. The CMF render
            uses these as a strict geometry reference and recolours each region
            from the workbook.
          </DialogDescription>
        </DialogHeader>

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
            <Button type="submit" disabled={uploadMutation.isPending} className="gap-2">
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload clown
            </Button>
          </div>
        </form>

        <div className="space-y-3 pt-3 border-t border-border/40">
          <h3 className="text-sm font-semibold">Library</h3>
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading clowns…
            </div>
          )}
          {!isLoading && (!clowns || clowns.length === 0) && (
            <p className="text-xs text-muted-foreground">
              {"No clown references uploaded yet."}
            </p>
          )}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {clowns?.map((clown) => (
              <div
                key={clown.id}
                className="rounded-lg border border-border/40 overflow-hidden bg-background/40"
              >
                <div className="aspect-square bg-black/30 flex items-center justify-center">
                  {clown.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={clown.imageUrl}
                      alt={clown.label}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="p-2.5 space-y-0.5">
                  <p className="text-xs font-medium truncate">{clown.label}</p>
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                    {clown.productSlug} · {clown.variantSlug}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
