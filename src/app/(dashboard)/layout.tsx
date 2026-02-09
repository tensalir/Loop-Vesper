import { RequireAuth } from '@/components/auth/RequireAuth'
import { DashboardSidebar } from '@/components/layout/DashboardSidebar'
import { DashboardHeader } from '@/components/layout/DashboardHeader'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <RequireAuth>
      <div className="min-h-screen flex bg-background">
        {/* Sidebar - hidden on mobile, shown on md+ */}
        <DashboardSidebar />
        
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          <DashboardHeader />
          
          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            <div className="p-4 md:p-6 lg:p-8">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </RequireAuth>
  )
}

