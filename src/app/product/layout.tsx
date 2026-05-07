import { RequireAuth } from '@/components/auth/RequireAuth'
import { ProductChrome } from '@/components/cmf/ProductChrome'

/**
 * Top-level layout for the /product subsite. Lives outside the (dashboard)
 * group so designers get a focused workspace — no sidebar — with the
 * floating Navbar pattern used by /projects/[id] and /headless.
 */
export default function ProductLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <RequireAuth>
      <ProductChrome>{children}</ProductChrome>
    </RequireAuth>
  )
}
