import { useQuery } from '@tanstack/react-query'

export interface Profile {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  role?: string
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

