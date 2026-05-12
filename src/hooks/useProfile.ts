import { useQuery } from '@tanstack/react-query'

export interface Profile {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  role?: string
  /** Per-user grant for the private /headless landing page. */
  headlessAccess?: boolean
  /** Per-user grant for CMF Studio writes (importing workbooks,
   *  generating renders, approving attempts). Reads stay open to
   *  every authenticated profile. */
  cmfAccess?: boolean
}

async function fetchProfile(): Promise<Profile> {
  const response = await fetch('/api/profile', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to fetch profile')
  }
  return response.json()
}

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

