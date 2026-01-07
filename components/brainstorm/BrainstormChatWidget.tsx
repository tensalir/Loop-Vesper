'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import type { Message } from '@ai-sdk/react'
import { 
  MessageCircle, 
  X, 
  Send, 
  Plus, 
  Trash2, 
  ChevronDown,
  Loader2,
  Sparkles,
  MoreHorizontal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

interface BrainstormChatWidgetProps {
  projectId: string
}

export function BrainstormChatWidget({ projectId }: BrainstormChatWidgetProps) {
  // Panel open/close state
  const [isOpen, setIsOpen] = useState(false)
  
  // Chat threads
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [showThreadList, setShowThreadList] = useState(false)
  
  // Delete confirmation
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null)
  
  // Message scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  // AI SDK useChat hook
  const { 
    messages, 
    input, 
    setInput, 
    handleSubmit, 
    isLoading,
    setMessages,
    error,
  } = useChat({
    api: `/api/projects/${projectId}/brainstorm/chat`,
    body: {
      chatId: activeThreadId,
    },
    onFinish: () => {
      // Refresh thread list to update titles
      fetchThreads()
    },
  })

  // Fetch threads for this project
  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/brainstorm/chats`)
      if (res.ok) {
        const data = await res.json()
        setThreads(data)
      }
    } catch (err) {
      console.error('Failed to fetch threads:', err)
    } finally {
      setThreadsLoading(false)
    }
  }, [projectId])

  // Fetch messages for active thread
  const fetchMessages = useCallback(async (threadId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/brainstorm/chats/${threadId}/messages`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data)
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err)
    }
  }, [projectId, setMessages])

  // Create a new chat thread
  const createThread = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/brainstorm/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' }),
      })
      if (res.ok) {
        const newThread = await res.json()
        setThreads(prev => [newThread, ...prev])
        setActiveThreadId(newThread.id)
        setMessages([])
        setShowThreadList(false)
      }
    } catch (err) {
      console.error('Failed to create thread:', err)
    }
  }

  // Delete a chat thread
  const deleteThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/brainstorm/chats/${threadId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setThreads(prev => prev.filter(t => t.id !== threadId))
        if (activeThreadId === threadId) {
          // Switch to another thread or clear
          const remaining = threads.filter(t => t.id !== threadId)
          if (remaining.length > 0) {
            setActiveThreadId(remaining[0].id)
            fetchMessages(remaining[0].id)
          } else {
            setActiveThreadId(null)
            setMessages([])
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete thread:', err)
    } finally {
      setDeletingThreadId(null)
    }
  }

  // Switch active thread
  const switchThread = (threadId: string) => {
    setActiveThreadId(threadId)
    fetchMessages(threadId)
    setShowThreadList(false)
  }

  // Initial load: fetch threads when panel opens
  useEffect(() => {
    if (isOpen && threads.length === 0) {
      fetchThreads()
    }
  }, [isOpen, threads.length, fetchThreads])

  // Load messages when active thread changes
  useEffect(() => {
    if (activeThreadId) {
      fetchMessages(activeThreadId)
    }
  }, [activeThreadId, fetchMessages])

  // Auto-select first thread on load
  useEffect(() => {
    if (threads.length > 0 && !activeThreadId) {
      setActiveThreadId(threads[0].id)
    }
  }, [threads, activeThreadId])

  // Reset when project changes
  useEffect(() => {
    setThreads([])
    setActiveThreadId(null)
    setMessages([])
    if (isOpen) {
      fetchThreads()
    }
  }, [projectId, fetchThreads, setMessages, isOpen])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen && activeThreadId) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [isOpen, activeThreadId])

  // Handle form submission
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    // If no active thread, create one first
    if (!activeThreadId) {
      try {
        const res = await fetch(`/api/projects/${projectId}/brainstorm/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'New Chat' }),
        })
        if (res.ok) {
          const newThread = await res.json()
          setThreads(prev => [newThread, ...prev])
          setActiveThreadId(newThread.id)
          // Wait for state to update then submit
          setTimeout(() => handleSubmit(e), 50)
        }
      } catch (err) {
        console.error('Failed to create thread:', err)
      }
      return
    }
    
    handleSubmit(e)
  }

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit(e)
    }
  }

  const activeThread = threads.find(t => t.id === activeThreadId)

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center justify-center",
          "w-14 h-14 rounded-full shadow-lg transition-all duration-300",
          "bg-primary text-primary-foreground hover:scale-105 hover:shadow-xl",
          isOpen && "rotate-0"
        )}
        title="Creative Brainstorm"
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <Sparkles className="w-6 h-6" />
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div 
          className={cn(
            "fixed bottom-24 right-6 z-50",
            "w-[380px] h-[520px] max-h-[70vh]",
            "bg-card border border-border rounded-2xl shadow-2xl",
            "flex flex-col overflow-hidden",
            "animate-in slide-in-from-bottom-4 fade-in duration-300"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">Brainstorm</span>
            </div>
            
            <div className="flex items-center gap-1">
              {/* Thread selector dropdown */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs gap-1"
                  onClick={() => setShowThreadList(!showThreadList)}
                >
                  <span className="max-w-[100px] truncate">
                    {activeThread?.title || 'Select chat'}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
                
                {showThreadList && (
                  <div className="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-10 py-1 max-h-64 overflow-y-auto">
                    <button
                      onClick={createThread}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                    >
                      <Plus className="w-4 h-4" />
                      New chat
                    </button>
                    <div className="border-t border-border my-1" />
                    {threadsLoading ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Loading...
                      </div>
                    ) : threads.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No chats yet
                      </div>
                    ) : (
                      threads.map((thread) => (
                        <div
                          key={thread.id}
                          className={cn(
                            "flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent group",
                            thread.id === activeThreadId && "bg-accent"
                          )}
                        >
                          <button
                            onClick={() => switchThread(thread.id)}
                            className="flex-1 text-left truncate"
                          >
                            {thread.title}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeletingThreadId(thread.id)
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              
              {/* New chat button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={createThread}
                title="New chat"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-4">
                <Sparkles className="w-10 h-10 mb-4 text-primary/40" />
                <p className="font-medium mb-1">Let's brainstorm!</p>
                <p className="text-sm">
                  Share your creative ideas and I'll help you explore directions for your images and videos.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                      message.role === 'user'
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted rounded-bl-md"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                </div>
              ))
            )}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            
            {error && (
              <div className="text-destructive text-sm text-center py-2">
                Something went wrong. Please try again.
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-border p-3 bg-card/95 backdrop-blur">
            <form onSubmit={onSubmit} className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="What would you like to explore?"
                className="min-h-[44px] max-h-[120px] resize-none rounded-xl text-sm py-3"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 rounded-xl shrink-0"
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletingThreadId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="font-semibold mb-2">Delete chat?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete this chat and all its messages.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingThreadId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteThread(deletingThreadId)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

