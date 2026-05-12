'use client'

import { useMemo } from 'react'
import { useProfile } from './useProfile'

/**
 * Resolve the caller's CMF Studio capabilities from `/api/profile`.
 *
 * Under the global-library model:
 *   - `canRead` is true for any signed-in profile (the library is
 *     visible to everyone). Returned as a flag for symmetry with
 *     `canWrite` and so consumers don't need to special-case logged-in
 *     status.
 *   - `canWrite` is true for admins and for any profile with the
 *     `cmfAccess` flag granted via the user-management settings.
 *   - `isAdmin` is true only when the role is literally `'admin'`.
 *
 * Surfaces use this to gate write affordances (Approve, Archive, +New
 * Attempt, Regenerate PDF, Import workbook) without round-tripping to
 * the server. The server still enforces the same gate via
 * `requireCmfWrite()` so the UI lock is purely UX, not security.
 */
export function useCmfPermissions() {
  const { data: profile, isLoading } = useProfile()

  return useMemo(() => {
    const isAdmin = profile?.role === 'admin'
    // `cmfAccess` is added to the Profile type at the schema level but
    // useProfile's local interface didn't list it explicitly — we read
    // it loosely so the hook works whether or not the type was widened.
    const cmfAccess = (profile as { cmfAccess?: boolean } | undefined)?.cmfAccess === true
    return {
      isLoading,
      isSignedIn: Boolean(profile?.id),
      canRead: Boolean(profile?.id),
      canWrite: isAdmin || cmfAccess,
      isAdmin,
    }
  }, [profile, isLoading])
}
