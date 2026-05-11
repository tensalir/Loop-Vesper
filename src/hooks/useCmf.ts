'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface CmfComponentSpec {
  region: string
  label: string
  pantone?: string | null
  colorHex?: string | null
  material?: string | null
  finish?: string | null
  technique?: string | null
  notes?: string | null
}

export interface CmfPaletteSwatch {
  label: string
  pantone?: string | null
  colorHex?: string | null
}

export interface CmfRenderAttempt {
  id: string
  renderId: string
  attemptNumber: number
  status: 'queued' | 'rendering' | 'ready' | 'failed'
  approvalStatus: 'pending' | 'approved' | 'archived'
  basePrompt: string | null
  enhancedPrompt: string | null
  modelId: string | null
  imageUrl: string | null
  imagePath: string | null
  imageWidth: number | null
  imageHeight: number | null
  error: string | null
  costUsd: number | null
  triggeredBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  archivedAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CmfRender {
  id: string
  packetId: string
  ownerId: string
  label: string
  productCode: string | null
  ean: string | null
  productSlug: string
  variantSlug: string
  colorwayName: string | null
  clownAssetId: string | null
  componentSpecs: CmfComponentSpec[]
  paletteSwatches: CmfPaletteSwatch[]
  modelId: string | null
  basePrompt: string | null
  enhancedPrompt: string | null
  renderUrl: string | null
  renderPath: string | null
  renderWidth: number | null
  renderHeight: number | null
  selectedAttemptId: string | null
  status: 'draft' | 'queued' | 'rendering' | 'ready' | 'failed'
  error: string | null
  attempts: number
  sortOrder: number
  createdAt: string
  updatedAt: string
  /** Newest attempts first. Empty when the SKU has not been rendered yet. */
  renderAttempts?: CmfRenderAttempt[]
}

export interface CmfDocumentDraft {
  packetName?: string
  cmfCode?: string
  notes?: string
  order?: string[]
  skuOverrides?: Array<{
    renderId: string
    colorwayLabel?: string
    subtitle?: string
    notes?: string
    imageSource?: 'approved' | 'draft'
    draftAttemptId?: string | null
  }>
  paletteOverrides?: CmfPaletteSwatch[]
}

export interface CmfPacket {
  id: string
  name: string
  cmfCode: string | null
  notes: string | null
  status: 'draft' | 'rendering' | 'ready' | 'failed'
  pdfUrl: string | null
  pdfPath: string | null
  pdfError: string | null
  generatedAt: string | null
  documentDraft: CmfDocumentDraft | null
  createdAt: string
  updatedAt: string
  renders: CmfRender[]
}

export interface CmfClownAsset {
  id: string
  /** Null for canonical / seeded clowns; otherwise the contributor's profile. */
  ownerId: string | null
  productSlug: string
  variantSlug: string
  label: string
  imageUrl: string
  storagePath: string
  components: Array<{ region: string; label: string; colorHex?: string | null }>
  createdAt: string
  updatedAt: string
}

export function useCmfPackets() {
  return useQuery({
    queryKey: ['cmf', 'packets'],
    queryFn: async (): Promise<CmfPacket[]> => {
      const res = await fetch('/api/cmf/packets')
      if (!res.ok) throw new Error('Failed to load CMF packets')
      const data = await res.json()
      return data.packets ?? []
    },
    staleTime: 15_000,
  })
}

export function useCmfPacket(packetId: string | null) {
  return useQuery({
    queryKey: ['cmf', 'packet', packetId],
    queryFn: async (): Promise<CmfPacket> => {
      const res = await fetch(`/api/cmf/packets/${packetId}`)
      if (!res.ok) throw new Error('Failed to load packet')
      const data = await res.json()
      return data.packet as CmfPacket
    },
    enabled: Boolean(packetId),
    refetchInterval: (query) => {
      const data = query.state.data as CmfPacket | undefined
      const anyRendering = data?.renders?.some(
        (r) => r.status === 'rendering' || r.status === 'queued'
      )
      return anyRendering ? 4000 : false
    },
  })
}

export function useCmfClowns(productSlug?: string) {
  return useQuery({
    queryKey: ['cmf', 'clowns', productSlug || 'all'],
    queryFn: async (): Promise<CmfClownAsset[]> => {
      const url = new URL('/api/cmf/clowns', window.location.origin)
      if (productSlug) url.searchParams.set('productSlug', productSlug)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load clown assets')
      const data = await res.json()
      return data.assets ?? []
    },
    staleTime: 30_000,
  })
}

export interface CmfImportResponse {
  import: {
    id: string
    status: string
    rowCount: number
    errors: Array<{ rowIndex: number; field?: string; message: string }>
    parsedRows?: unknown[]
  }
  packet?: CmfPacket
}

export function useImportCmfWorkbook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      file: File
      packetName?: string
      cmfCode?: string
      notes?: string
      createPacket?: boolean
    }): Promise<CmfImportResponse> => {
      const formData = new FormData()
      formData.append('file', args.file)
      if (args.packetName) formData.append('packetName', args.packetName)
      if (args.cmfCode) formData.append('cmfCode', args.cmfCode)
      if (args.notes) formData.append('notes', args.notes)
      if (args.createPacket) formData.append('createPacket', 'true')

      const res = await fetch('/api/cmf/import', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Import failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packets'] })
    },
  })
}

export function useUploadClown() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      file: File
      productSlug: string
      variantSlug?: string
      label: string
      components?: Array<{ region: string; label: string; colorHex?: string }>
    }): Promise<CmfClownAsset> => {
      const formData = new FormData()
      formData.append('file', args.file)
      formData.append('productSlug', args.productSlug)
      if (args.variantSlug) formData.append('variantSlug', args.variantSlug)
      formData.append('label', args.label)
      if (args.components) formData.append('components', JSON.stringify(args.components))

      const res = await fetch('/api/cmf/clowns', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Upload failed')
      }
      const data = await res.json()
      return data.asset as CmfClownAsset
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'clowns'] })
    },
  })
}

export interface CmfClownBulkResult {
  zip: string
  inner: string
  productSlug: string | null
  variantSlug: string | null
  status: 'uploaded' | 'replaced' | 'skipped' | 'error'
  message?: string
}

export interface CmfClownBulkResponse {
  summary: {
    uploaded: number
    replaced: number
    skipped: number
    total: number
  }
  results: CmfClownBulkResult[]
}

/**
 * Bulk-upload one or more "Clown Renders" zip files. The server uses the
 * canonical zip→product mapping (`clown-zip-mapping.ts`) so the same
 * payload that seeds production locally can be fed by a designer
 * dragging zips into the dialog.
 */
export function useUploadClownsBulk() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { files: File[] }): Promise<CmfClownBulkResponse> => {
      const formData = new FormData()
      for (const file of args.files) {
        formData.append('files', file)
      }
      const res = await fetch('/api/cmf/clowns/bulk', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Bulk upload failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'clowns'] })
    },
  })
}

export function useUpdateCmfRender() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      renderId: string
      packetId: string
      data: Partial<{
        label: string
        productCode: string | null
        ean: string | null
        colorwayName: string | null
        clownAssetId: string | null
        modelId: string
        componentSpecs: CmfComponentSpec[]
        paletteSwatches: CmfPaletteSwatch[]
      }>
    }): Promise<CmfRender> => {
      const res = await fetch(`/api/cmf/renders/${args.renderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args.data),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Update failed')
      }
      const data = await res.json()
      return data.render as CmfRender
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
    },
  })
}

export function useGenerateCmfRender() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      renderId: string
      packetId: string
    }): Promise<CmfRender> => {
      const res = await fetch(`/api/cmf/renders/${args.renderId}/generate`, {
        method: 'POST',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Render failed')
      }
      const data = await res.json()
      return data.render as CmfRender
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packets'] })
    },
  })
}

export interface CmfBulkGenerateSummary {
  sku: number
  attempts: number
  started: number
  failed: number
}

export interface CmfBulkGenerateResult {
  summary: CmfBulkGenerateSummary
  results: Array<{ renderId: string; attempt: number; ok: boolean; error?: string }>
}

/**
 * Kick off the "Nano Banana bulk" workflow: 3 attempts per SKU by default.
 * The packet query is invalidated so the gallery refreshes once attempts
 * settle on the server.
 */
export function useBulkGenerateCmfPacket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      packetId: string
      attemptsPerSku?: number
      renderIds?: string[]
    }): Promise<CmfBulkGenerateResult> => {
      const res = await fetch(`/api/cmf/packets/${args.packetId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptsPerSku: args.attemptsPerSku,
          renderIds: args.renderIds,
        }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Bulk generation failed')
      }
      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packets'] })
    },
  })
}

export function useCmfAttemptAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      attemptId: string
      packetId: string
      action: 'approve' | 'archive' | 'restore'
    }) => {
      const res = await fetch(`/api/cmf/attempts/${args.attemptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: args.action }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Attempt action failed')
      }
      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packets'] })
    },
  })
}

export function useUpdateCmfDocumentDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: { packetId: string; documentDraft: CmfDocumentDraft }) => {
      const res = await fetch(`/api/cmf/packets/${args.packetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentDraft: args.documentDraft }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to save document draft')
      }
      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
    },
  })
}

export function useGenerateCmfPdf() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      packetId: string
      allowDraft?: boolean
    }): Promise<CmfPacket> => {
      const res = await fetch(`/api/cmf/packets/${args.packetId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowDraft: !!args.allowDraft }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.error || 'PDF generation failed')
      }
      const data = await res.json()
      return data.packet as CmfPacket
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packet', variables.packetId] })
      queryClient.invalidateQueries({ queryKey: ['cmf', 'packets'] })
    },
  })
}
