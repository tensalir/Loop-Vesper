'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { User, BarChart3, Sparkles, Image as ImageIcon, Users } from 'lucide-react'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { AnalyticsSettings } from '@/components/settings/AnalyticsSettings'
import { PromptManagementSettings } from '@/components/settings/PromptManagementSettings'
import { RendersManagementSettings } from '@/components/settings/RendersManagementSettings'
import { UserManagementSettings } from '@/components/settings/UserManagementSettings'

export default function SettingsPage() {
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
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className={`grid w-full max-w-lg ${isAdmin ? 'grid-cols-5' : 'grid-cols-3'}`}>
          <TabsTrigger value="account" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Account</span>
          </TabsTrigger>
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="prompts" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Prompts</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Users</span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="renders" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Renders</span>
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
          <TabsContent value="users" className="mt-6">
            <UserManagementSettings />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="renders" className="mt-6">
            <RendersManagementSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

