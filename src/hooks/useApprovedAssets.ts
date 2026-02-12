import { useQuery } from '@tanstack/react-query'

export interface ApprovedAssetRecord {
  linkId: string
  mondayItemId: string | null
  name: string
  month: string | null
  batch: string | null
  final_link: string | null
  link_for_review: string | null
  figma_file_key: string | null
  matchStatus: 'matched' | 'unmatched'
  matchConfidence: number | null
  matchRationale: string | null
  matchedFrontifyAssetId: string | null
  hasApproval: boolean
}

export interface UseApprovedAssetsParams {
  month?: string
  batch?: string
  matchStatus?: 'matched' | 'unmatched'
}

async function fetchApprovedAssets(params: UseApprovedAssetsParams = {}): Promise<ApprovedAssetRecord[]> {
  const search = new URLSearchParams()
  if (params.month) search.set('month', params.month)
  if (params.batch) search.set('batch', params.batch)
  if (params.matchStatus) search.set('matchStatus', params.matchStatus)
  const qs = search.toString()
  const url = qs ? `/api/review/approved-assets?${qs}` : '/api/review/approved-assets'
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch approved assets')
  return response.json()
}

export function useApprovedAssets(params: UseApprovedAssetsParams = {}) {
  return useQuery({
    queryKey: ['approvedAssets', params.month ?? '', params.batch ?? '', params.matchStatus ?? ''],
    queryFn: () => fetchApprovedAssets(params),
    staleTime: 60_000,
  })
}
