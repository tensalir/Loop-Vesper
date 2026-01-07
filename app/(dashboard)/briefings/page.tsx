'use client'

import { FileText } from 'lucide-react'

export default function BriefingsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Briefings</h1>
          <p className="text-muted-foreground">
            Manage your project briefs and requirements
          </p>
        </div>
      </div>

      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="rounded-full bg-muted p-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Briefings coming soon</h2>
          <p className="text-muted-foreground max-w-md">
            This feature is under development. Soon you&apos;ll be able to create and manage 
            detailed project briefs here.
          </p>
        </div>
      </div>
    </div>
  )
}

