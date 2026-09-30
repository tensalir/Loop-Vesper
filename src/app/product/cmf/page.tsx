'use client'

import { Suspense } from 'react'
import { CmfStudio } from '@/components/cmf/CmfStudio'

/**
 * CMF Studio: the CMF steps Claude takes, in the web, over the same CMF service
 * (`src/lib/creative/cmf/service.ts`, through `/api/cmf/v2/*`). The open tab and upload live in
 * the URL (`?tab=&upload=`).
 */
export default function CmfStudioPage() {
  return (
    <Suspense fallback={null}>
      <CmfStudio />
    </Suspense>
  )
}
