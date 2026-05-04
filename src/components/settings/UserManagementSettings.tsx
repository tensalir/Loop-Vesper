'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Loader2,
  Search,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  FolderOpen,
  Layers,
  ChevronLeft,
  ChevronRight,
  KeyRound,
} from 'lucide-react'

interface AdminUser {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  role: 'admin' | 'user'
  // Per-user grant for the private /headless landing page. Admins always
  // see /headless via their role, so this flag is only meaningful for
  // role: 'user' accounts (Loop teammates and external partners).
  headlessAccess: boolean
  pausedAt: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  generationCount: number
  projectCount: number
  lastActiveAt: string | null
}

type StatusFilter = 'all' | 'active' | 'paused' | 'deleted'

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function getUserStatus(user: AdminUser): 'active' | 'paused' | 'deleted' {
  if (user.deletedAt) return 'deleted'
  if (user.pausedAt) return 'paused'
  return 'active'
}

function StatusBadge({ status }: { status: 'active' | 'paused' | 'deleted' }) {
  switch (status) {
    case 'active':
      return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">Active</Badge>
    case 'paused':
      return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800">Paused</Badge>
    case 'deleted':
      return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800">Deleted</Badge>
  }
}

function UserAvatar({ user }: { user: AdminUser }) {
  const initials = (user.displayName || user.username || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.displayName || user.username || 'User avatar'}
        className="h-8 w-8 rounded-full object-cover"
      />
    )
  }

  return (
    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
      {initials}
    </div>
  )
}

export function UserManagementSettings() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Pause dialog
  const [pauseTarget, setPauseTarget] = useState<AdminUser | null>(null)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [transferToUserId, setTransferToUserId] = useState<string>('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const res = await fetch(`/api/admin/users?${params}`)
      if (!res.ok) {
        const text = await res.text()
        let message = `Failed to fetch users (${res.status})`
        try { message = JSON.parse(text).error || message } catch { /* non-JSON response */ }
        throw new Error(message)
      }
      const data = await res.json()
      setUsers(data.users)
      setTotal(data.total)
      setTotalPages(data.totalPages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, debouncedSearch])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handlePause = async (user: AdminUser) => {
    const isPaused = !!user.pausedAt
    setActionLoading(user.id)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isPaused ? 'unpause' : 'pause' }),
      })
      if (!res.ok) {
        const text = await res.text()
        let message = 'Failed to update user status'
        try { message = JSON.parse(text).error || message } catch { /* non-JSON */ }
        throw new Error(message)
      }
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user status')
    } finally {
      setActionLoading(null)
      setPauseTarget(null)
    }
  }

  const handleToggleHeadlessAccess = async (user: AdminUser) => {
    setActionLoading(user.id)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/headless-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !user.headlessAccess }),
      })
      if (!res.ok) {
        const text = await res.text()
        let message = 'Failed to update headless access'
        try { message = JSON.parse(text).error || message } catch { /* non-JSON */ }
        throw new Error(message)
      }
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update headless access')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(deleteTarget.id)
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transferToUserId: transferToUserId && transferToUserId !== 'none' ? transferToUserId : undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        let message = 'Failed to delete user'
        try { message = JSON.parse(text).error || message } catch { /* non-JSON */ }
        throw new Error(message)
      }
      await fetchUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setActionLoading(null)
      setDeleteTarget(null)
      setTransferToUserId('')
    }
  }

  const transferCandidates = users.filter(
    (u) => u.id !== deleteTarget?.id && !u.deletedAt
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>
          View all users, their activity, and manage account status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchUsers} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
            {error}
          </div>
        )}

        {/* Table */}
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {searchQuery || statusFilter !== 'all' ? 'No users match your filters.' : 'No users found.'}
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium p-3">User</th>
                  <th className="text-left font-medium p-3 hidden md:table-cell">Status</th>
                  <th className="text-left font-medium p-3 hidden lg:table-cell">Last Active</th>
                  <th className="text-left font-medium p-3 hidden lg:table-cell">Stats</th>
                  <th className="text-left font-medium p-3 hidden md:table-cell">Joined</th>
                  <th className="text-right font-medium p-3 w-[50px]"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const status = getUserStatus(user)
                  const isCurrentAction = actionLoading === user.id

                  return (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={user} />
                          <div className="min-w-0">
                            <div className="font-medium truncate flex items-center gap-2">
                              {user.displayName || user.username || 'Unnamed'}
                              {user.role === 'admin' && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Admin</Badge>
                              )}
                              {user.role !== 'admin' && user.headlessAccess && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 border-primary/40 text-primary"
                                  title="This user can view the private /headless landing page"
                                >
                                  Headless
                                </Badge>
                              )}
                              <span className="md:hidden">
                                <StatusBadge status={status} />
                              </span>
                            </div>
                            {user.username && user.displayName && (
                              <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <StatusBadge status={status} />
                      </td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground">
                        {formatRelativeTime(user.lastActiveAt)}
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span className="flex items-center gap-1" title="Projects">
                            <FolderOpen className="h-3.5 w-3.5" />
                            {user.projectCount}
                          </span>
                          <span className="flex items-center gap-1" title="Generations">
                            <Layers className="h-3.5 w-3.5" />
                            {user.generationCount}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        {user.role !== 'admin' && !user.deletedAt && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isCurrentAction}>
                                {isCurrentAction ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleToggleHeadlessAccess(user)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                {user.headlessAccess
                                  ? 'Revoke Headless Access'
                                  : 'Grant Headless Access'}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setPauseTarget(user)}>
                                {user.pausedAt ? (
                                  <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Unpause Account
                                  </>
                                ) : (
                                  <>
                                    <Pause className="h-4 w-4 mr-2" />
                                    Pause Account
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(user)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete Account
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {total} user{total !== 1 ? 's' : ''} total
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Pause Confirmation Dialog */}
        <AlertDialog open={!!pauseTarget} onOpenChange={(open) => !open && setPauseTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pauseTarget?.pausedAt ? 'Unpause' : 'Pause'} Account
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pauseTarget?.pausedAt
                  ? `This will restore access for ${pauseTarget?.displayName || pauseTarget?.username || 'this user'}. They will be able to log in again.`
                  : `This will block ${pauseTarget?.displayName || pauseTarget?.username || 'this user'} from logging in. They will see an "Account Paused" message when they try to access the app.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => pauseTarget && handlePause(pauseTarget)}
                className={pauseTarget?.pausedAt ? '' : 'bg-amber-600 hover:bg-amber-700'}
              >
                {pauseTarget?.pausedAt ? 'Unpause' : 'Pause'} Account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Dialog with Transfer Option */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setTransferToUserId('')
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Account</DialogTitle>
              <DialogDescription>
                {"This will soft-delete the account for "}
                <span className="font-medium text-foreground">
                  {deleteTarget?.displayName || deleteTarget?.username || 'this user'}
                </span>
                {". The user will no longer be able to log in."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {deleteTarget && (deleteTarget.projectCount > 0 || deleteTarget.generationCount > 0) && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Transfer data to another user (optional)</p>
                  <p className="text-xs text-muted-foreground">
                    {"This user has "}
                    {deleteTarget.projectCount > 0 && `${deleteTarget.projectCount} project${deleteTarget.projectCount !== 1 ? 's' : ''}`}
                    {deleteTarget.projectCount > 0 && deleteTarget.generationCount > 0 && ' and '}
                    {deleteTarget.generationCount > 0 && `${deleteTarget.generationCount} generation${deleteTarget.generationCount !== 1 ? 's' : ''}`}
                    {". You can transfer ownership to another user."}
                  </p>
                  <Select
                    value={transferToUserId}
                    onValueChange={setTransferToUserId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No transfer (keep with deleted user)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No transfer</SelectItem>
                      {transferCandidates.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.displayName || u.username || u.id}
                          {u.role === 'admin' ? ' (admin)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setDeleteTarget(null); setTransferToUserId('') }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={actionLoading === deleteTarget?.id}>
                {actionLoading === deleteTarget?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
