'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, User, BarChart3, Sparkles, Image as ImageIcon } from 'lucide-react'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { AnalyticsSettings } from '@/components/settings/AnalyticsSettings'
import { PromptManagementSettings } from '@/components/settings/PromptManagementSettings'
import { RendersManagementSettings } from '@/components/settings/RendersManagementSettings'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('account')
  const [isAdmin, setIsAdmin] = useState(false)

  // Check if user is admin
  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await fetch('/api/profile')
        if (response.ok) {
          const profile = await response.json()
          setIsAdmin(profile.role === 'admin')
        }
      } catch (error) {
        console.error('Failed to check admin status:', error)
      }
    }
    checkAdminStatus()
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/projects')}
            className="hover:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`grid w-full max-w-md ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <TabsTrigger value="account" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Account
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="prompts" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Prompts
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="renders" className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Renders
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="account" className="mt-6">
            <AccountSettings />
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <AnalyticsSettings />
          </TabsContent>

          <TabsContent value="prompts" className="mt-6">
            <PromptManagementSettings />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="renders" className="mt-6">
              <RendersManagementSettings />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}

