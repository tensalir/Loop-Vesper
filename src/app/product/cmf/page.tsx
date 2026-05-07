'use client'

import { CmfPacketWorkspace } from '@/components/cmf/CmfPacketWorkspace'

/**
 * CMF Studio. Lives at the top level (no dashboard chrome) so the pipeline
 * spine can own the visual rhythm. The packet selector and stage drawers
 * are mounted from inside the workspace.
 */
export default function CmfStudioPage() {
  return <CmfPacketWorkspace initialPacketId={null} />
}
