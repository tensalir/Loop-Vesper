'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { CmfPacketWorkspace } from '@/components/cmf/CmfPacketWorkspace'

/**
 * CMF Studio. Lives at the top level (no dashboard chrome) so the pipeline
 * spine can own the visual rhythm. The packet selector and stage drawers
 * are mounted from inside the workspace.
 *
 * The active packet is mirrored to the URL as `?packet=<id>` so refresh,
 * sharing a link, or hitting back/forward all keep the designer on the same
 * packet. The workspace updates the URL via `router.replace` whenever the
 * selection changes.
 */
export default function CmfStudioPage() {
  return (
    <Suspense fallback={null}>
      <CmfStudioPageInner />
    </Suspense>
  )
}

function CmfStudioPageInner() {
  const search = useSearchParams()
  const packetId = search?.get('packet') ?? null
  return <CmfPacketWorkspace initialPacketId={packetId} />
}
