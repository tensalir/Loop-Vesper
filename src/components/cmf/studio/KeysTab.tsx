'use client'

/**
 * Clowns and keys: the product kit's clown keys and their clowns, read only. A key says which
 * colour of the clown is which component; Damien names and confirms it in the product kit's
 * repository, and a change reaches Vesper with the next kit. Nothing here can be replaced or
 * edited.
 */

import { Loader2 } from 'lucide-react'
import { toViewUrl } from '@/lib/storage/refs'
import { useCmfKeys } from '@/hooks/useCmf'
import { Empty, KeyState, Panel, Refusal, short } from './parts'

export function KeysTab() {
  const { data, isLoading, error } = useCmfKeys()
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        From the product kit {data?.kit_tag ?? data?.kit_version ?? ''}
        {data?.kit_commit ? ` (${data.kit_commit.slice(0, 7)})` : ''}. A key changes only in the product kit&apos;s repository, where Damien names each zone and confirms the key. A draft key
        cannot make a prompt; a key that is not confirmed yet cannot go on a supplier PDF.
      </p>
      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <Refusal error={error} />
      {data && data.keys.length === 0 && <Empty>The kit carries no clown key.</Empty>}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data?.keys.map((k) => (
          <Panel key={k.id} className="space-y-2">
            {k.clown_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={toViewUrl(k.clown_url)} alt={`The clown of ${k.id}`} className="w-full rounded-lg border border-border/40 bg-background" />
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground">
                {k.clown ? 'The clown is not pinned in Vesper yet (an admin syncs the pins).' : 'No clown named.'}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs">{k.id}</span>
              <KeyState keyState={k} />
            </div>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>
                {k.product ?? 'no product'}
                {k.variant ? ` · ${k.variant}` : ''}
                {k.tabs.length ? ` · for ${k.tabs.join(', ')}` : ''}
              </div>
              {k.clown && (
                <div>
                  Clown <span className="font-mono">{k.clown.id}</span> · sha256 <span className="font-mono">{short(k.clown.sha256)}</span>
                  {k.clown.width && k.clown.height ? ` · ${k.clown.width}×${k.clown.height}` : ''}
                  {k.pinned ? '' : ' · not pinned'}
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
