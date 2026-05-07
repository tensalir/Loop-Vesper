'use client'

import { useState } from 'react'
import { CmfImportPanel } from '@/components/cmf/CmfImportPanel'
import { CmfPacketList } from '@/components/cmf/CmfPacketList'
import { CmfPacketWorkspace } from '@/components/cmf/CmfPacketWorkspace'
import { CmfClownLibraryDialog } from '@/components/cmf/CmfClownLibraryDialog'
import { Button } from '@/components/ui/button'
import { ImageIcon, Palette } from 'lucide-react'

export default function CmfStudioPage() {
  const [activePacketId, setActivePacketId] = useState<string | null>(null)
  const [clownDialogOpen, setClownDialogOpen] = useState(false)

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Product · CMF
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            CMF Studio
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Import a CMF workbook, resolve clown references, generate
            colourway renders, and export the packet PDF — one file per
            colourway with a shared breakdown.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setClownDialogOpen(true)}
            className="gap-2"
          >
            <ImageIcon className="h-4 w-4" />
            Clown library
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-6">
          <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                Import workbook
              </h2>
            </div>
            <CmfImportPanel onPacketCreated={setActivePacketId} />
          </div>
          <CmfPacketList
            activePacketId={activePacketId}
            onSelect={setActivePacketId}
          />
        </aside>

        <section>
          <CmfPacketWorkspace
            packetId={activePacketId}
            onOpenClownLibrary={() => setClownDialogOpen(true)}
          />
        </section>
      </div>

      <CmfClownLibraryDialog
        open={clownDialogOpen}
        onOpenChange={setClownDialogOpen}
      />
    </div>
  )
}
