'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport, type UIMessage } from 'ai'
import { 
  X, 
  Send, 
  Plus, 
  Trash2, 
  ChevronDown,
  Loader2,
  Sparkles,
  Paperclip,
  FileText,
  Image as ImageIcon,
  ArrowRight,
  Copy,
  Check as CheckIcon,
  GripHorizontal,
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
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Callback to send a prompt to the main generation input */
  onSendPrompt?: (prompt: string) => void
}

export function BrainstormChatWidget({ projectId, isOpen: controlledIsOpen, onOpenChange, onSendPrompt }: BrainstormChatWidgetProps) {
  // Panel open/close state (controlled or uncontrolled)
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen
  const setIsOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open)
    } else {
      setInternalIsOpen(open)
    }
  }
  const [input, setInput] = useState('')
  
  // File attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [filePreviews, setFilePreviews] = useState<{ file: File; preview: string; type: 'image' | 'document' }[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  
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
  const activeThreadIdRef = useRef<string | null>(null)
  
  // Resizable input height
  const [inputHeight, setInputHeight] = useState(44) // Default min height
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId
  }, [activeThreadId])

  const transport = useMemo(() => {
    return new TextStreamChatTransport({
      api: `/api/projects/${projectId}/brainstorm/chat`,
      body: () =>
        activeThreadIdRef.current ? { chatId: activeThreadIdRef.current } : {},
    })
  }, [projectId])

  const getMessageText = (message: UIMessage): string => {
    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  
  // AI SDK useChat hook
  const { messages, setMessages, sendMessage, status, error } = useChat({
    id: `brainstorm-${projectId}`,
    transport,
    onFinish: () => {
      // Refresh thread list to update titles
      fetchThreads()
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'
  const canSend = !isLoading && !isUploading

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
  const createThread = async (): Promise<ChatThread | null> => {
    try {
      const res = await fetch(`/api/projects/${projectId}/brainstorm/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Chat' }),
      })
      if (res.ok) {
        const newThread = await res.json()
        setThreads(prev => [newThread, ...prev])
        activeThreadIdRef.current = newThread.id
        setActiveThreadId(newThread.id)
        setMessages([])
        setShowThreadList(false)
        return newThread
      }
    } catch (err) {
      console.error('Failed to create thread:', err)
    }
    return null
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
            activeThreadIdRef.current = remaining[0].id
            setActiveThreadId(remaining[0].id)
            fetchMessages(remaining[0].id)
          } else {
            activeThreadIdRef.current = null
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
    activeThreadIdRef.current = threadId
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
      activeThreadIdRef.current = threads[0].id
      setActiveThreadId(threads[0].id)
    }
  }, [threads, activeThreadId])

  // Reset when project changes
  useEffect(() => {
    setThreads([])
    activeThreadIdRef.current = null
    setActiveThreadId(null)
    setMessages([])
    setInput('')
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

  // Convert file to base64 data URL for Claude vision
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Upload files to Supabase
  const uploadFilesToSupabase = async (files: File[]): Promise<{ name: string; url: string; type: string }[]> => {
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    
    const response = await fetch(`/api/projects/${projectId}/brainstorm/attachments`, {
      method: 'POST',
      body: formData,
    })
    
    if (!response.ok) {
      throw new Error('Failed to upload files')
    }
    
    const data = await response.json()
    return data.files
  }

  // Handle form submission
  const submitCurrentInput = async () => {
    const text = input.trim()
    const hasFiles = attachedFiles.length > 0
    
    if ((!text && !hasFiles) || isLoading || !canSend || isUploading) return

    if (!activeThreadIdRef.current) {
      const newThread = await createThread()
      if (!newThread) return
    }

    try {
      // Build message with attachments
      let messageText = text
      const imageDataUrls: string[] = []
      
      // If we have files, process them for Claude vision + upload to Supabase for persistence
      if (hasFiles) {
        setIsUploading(true)
        
        try {
          // Upload files to Supabase for persistence/display
          const uploadedFiles = await uploadFilesToSupabase(attachedFiles)
          const fileDescriptions: string[] = []
          
          for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i]
            const originalFile = attachedFiles[i]
            
            if (file.type.startsWith('image/')) {
              // For images: Convert to base64 so Claude can actually SEE them
              const base64 = await fileToBase64(originalFile)
              imageDataUrls.push(base64)
              fileDescriptions.push(`[Attached image: ${file.name}](${file.url})`)
            } else {
              // For documents: Include as text reference
              fileDescriptions.push(`[Attached file: ${file.name}](${file.url})`)
            }
          }
          
          // Build message: include image data URLs in a special format for the API to parse
          // Format: <<IMAGE_DATA:base64_url>> for each image
          let imageDataSection = ''
          if (imageDataUrls.length > 0) {
            imageDataSection = imageDataUrls.map(url => `<<IMAGE_DATA:${url}>>`).join('\n') + '\n\n'
          }
          
          // Prepend file descriptions to message for display/persistence
          if (fileDescriptions.length > 0 && !text) {
            messageText = imageDataSection + fileDescriptions.join('\n')
          } else if (fileDescriptions.length > 0) {
            messageText = imageDataSection + fileDescriptions.join('\n') + '\n\n' + text
          } else if (imageDataSection) {
            messageText = imageDataSection + text
          }
        } catch (uploadError) {
          console.error('Failed to upload files:', uploadError)
          // Fall back to just mentioning file names without URLs
          const fileNames = attachedFiles.map(f => `[Attached: ${f.name}]`).join('\n')
          if (!text) {
            messageText = fileNames
          } else {
            messageText = fileNames + '\n\n' + text
          }
        } finally {
          setIsUploading(false)
        }
      }
      
      // Send message
      await sendMessage({ text: messageText })
      setInput('')
      setAttachedFiles([])
      setFilePreviews([])
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submitCurrentInput()
  }

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submitCurrentInput()
    }
  }

  // Handle file selection from input
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    
    addFiles(files)
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Remove attached file
  const removeAttachedFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
    setFilePreviews(prev => prev.filter((_, i) => i !== index))
  }

  // Add files from drag/drop or file input
  const addFiles = (files: File[]) => {
    files.forEach(file => {
      const isImage = file.type.startsWith('image/')
      
      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          setFilePreviews(prev => [...prev, {
            file,
            preview: e.target?.result as string,
            type: 'image'
          }])
        }
        reader.readAsDataURL(file)
      } else {
        setFilePreviews(prev => [...prev, {
          file,
          preview: file.name,
          type: 'document'
        }])
      }
    })
    
    setAttachedFiles(prev => [...prev, ...files])
  }

  // Resize handlers for expanding/collapsing input area
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    setIsResizing(true)
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    resizeStartY.current = clientY
    resizeStartHeight.current = inputHeight
  }, [inputHeight])

  const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isResizing) return
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    // Calculate delta (negative because we're dragging up to expand)
    const delta = resizeStartY.current - clientY
    const newHeight = Math.min(Math.max(resizeStartHeight.current + delta, 44), 200) // Min 44px, max 200px
    setInputHeight(newHeight)
  }, [isResizing])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Global mouse/touch events for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
      document.addEventListener('touchmove', handleResizeMove)
      document.addEventListener('touchend', handleResizeEnd)
      return () => {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.removeEventListener('touchmove', handleResizeMove)
        document.removeEventListener('touchend', handleResizeEnd)
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging false if we're leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      addFiles(files)
    }
  }

  const activeThread = threads.find(t => t.id === activeThreadId)

  // Check if widget is being controlled externally (from the control bar)
  const isControlled = onOpenChange !== undefined

  // Extract prompts from AI messages - looks for quoted text or text following "Prompt:" patterns
  const extractPrompts = (text: string): string[] => {
    const prompts: string[] = []
    
    // Match text in double quotes that looks like a prompt (more than 20 chars)
    const quotedMatches = text.match(/"([^"]{20,})"/g)
    if (quotedMatches) {
      quotedMatches.forEach(match => {
        prompts.push(match.slice(1, -1)) // Remove quotes
      })
    }
    
    // Match text after "Prompt:" or similar labels
    const labeledMatches = text.match(/(?:Prompt|Try this|Suggested prompt|Here's a prompt)[:\s]+[""]?([^""]+)[""]?/gi)
    if (labeledMatches) {
      labeledMatches.forEach(match => {
        const cleaned = match.replace(/^(?:Prompt|Try this|Suggested prompt|Here's a prompt)[:\s]+[""]?/i, '').replace(/[""]$/, '').trim()
        if (cleaned.length > 20 && !prompts.includes(cleaned)) {
          prompts.push(cleaned)
        }
      })
    }
    
    // Match code blocks that might contain prompts
    const codeBlockMatches = text.match(/```(?:prompt)?\n?([\s\S]*?)```/g)
    if (codeBlockMatches) {
      codeBlockMatches.forEach(match => {
        const content = match.replace(/```(?:prompt)?\n?/g, '').replace(/```/g, '').trim()
        if (content.length > 20 && !prompts.includes(content)) {
          prompts.push(content)
        }
      })
    }
    
    return prompts
  }

  // State to track copied prompts
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)

  // Handle sending prompt to main input
  const handleSendPrompt = (prompt: string) => {
    if (onSendPrompt) {
      onSendPrompt(prompt)
    }
  }

  // Handle copying prompt
  const handleCopyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedPrompt(prompt)
      setTimeout(() => setCopiedPrompt(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <>
      {/* Floating trigger button - only show when not controlled externally */}
      {!isControlled && (
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
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="relative">
          {/* Connector line from control bar (only when controlled) */}
          {isControlled && (
            <div 
              className="fixed bottom-[2.25rem] h-[2px] bg-border/50 z-30"
              style={{ 
                left: 'calc(50% + 28rem)',
                width: '1.5rem'
              }}
            />
          )}
          
          <div 
            ref={dropZoneRef}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
              "z-40",
              // Responsive sizing: taller on larger screens, constrained on smaller
              "w-[420px] max-w-[calc(100vw-3rem)]",
              "h-[calc(100vh-10rem)] min-h-[400px] max-h-[800px]",
              "bg-card border rounded-2xl shadow-2xl",
              "flex flex-col overflow-hidden",
              // Position based on whether controlled (from control bar) or standalone
              isControlled 
                ? "fixed bottom-6 left-[calc(50%+29.5rem)] animate-in slide-in-from-left-8 fade-in duration-300 ease-out"
                : "fixed bottom-24 right-6 animate-in slide-in-from-bottom-4 fade-in duration-300",
              // Drag state styling
              isDragging 
                ? "border-primary border-2 ring-2 ring-primary/20" 
                : "border-border"
            )}
          >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-card/95 backdrop-blur-sm rounded-2xl">
              <div className="flex flex-col items-center gap-3 text-primary">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Paperclip className="w-8 h-8" />
                </div>
                <p className="font-medium">Drop files here</p>
                <p className="text-sm text-muted-foreground">Images, PDFs, documents</p>
              </div>
            </div>
          )}
          
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
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
                  <div className="absolute top-full right-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                    <button
                      onClick={createThread}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-left"
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
                            "flex items-center justify-between gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted group",
                            thread.id === activeThreadId && "bg-muted"
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
                <p className="font-medium mb-1">Let&apos;s brainstorm!</p>
                <p className="text-sm">
                  Share your creative ideas and I&apos;ll help you explore directions for your images and videos.
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const messageText = getMessageText(message)
                
                // Extract image URLs from markdown-style links
                const imageUrlRegex = /\[Attached image: [^\]]+\]\(([^)]+)\)/g
                const fileUrlRegex = /\[Attached file: [^\]]+\]\(([^)]+)\)/g
                // NOTE: Avoid spreading iterators; Vercel TypeScript target can fail without downlevelIteration
                const imageMatches = Array.from(messageText.matchAll(imageUrlRegex))
                const fileMatches = Array.from(messageText.matchAll(fileUrlRegex))
                
                // Check if message contains attachment markers
                const hasAttachments = messageText.includes('[Attached image:') || messageText.includes('[Attached file:') || messageText.includes('[Attached:')
                
                // Clean message text for display (remove attachment markers for cleaner view)
                const displayText = messageText
                  .replace(/\[Attached image: [^\]]+\]\([^)]+\)\n?/g, '')
                  .replace(/\[Attached file: [^\]]+\]\([^)]+\)\n?/g, '')
                  .replace(/\[Attached image: [^\]]+\]\n?/g, '')
                  .replace(/\[Attached file: [^\]]+\]\n?/g, '')
                  .replace(/\[Attached: [^\]]+\]\n?/g, '')
                  .trim()
                
                return (
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
                      {/* Show attached images */}
                      {imageMatches.length > 0 && message.role === 'user' && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {imageMatches.map((match, idx) => (
                            <a 
                              key={idx} 
                              href={match[1]} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="block w-20 h-20 rounded-lg overflow-hidden border border-primary-foreground/20"
                            >
                              <img
                                src={match[1]}
                                alt="Attached"
                                className="w-full h-full object-cover hover:opacity-80 transition-opacity"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      
                      {/* Show attached files */}
                      {fileMatches.length > 0 && message.role === 'user' && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {fileMatches.map((match, idx) => (
                            <a
                              key={idx}
                              href={match[1]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2 py-1 rounded bg-primary-foreground/10 text-xs hover:bg-primary-foreground/20 transition-colors"
                            >
                              <FileText className="w-3 h-3" />
                              <span>View file</span>
                            </a>
                          ))}
                        </div>
                      )}
                      
                      {/* Show attachment indicator if no URLs (fallback) */}
                      {hasAttachments && imageMatches.length === 0 && fileMatches.length === 0 && message.role === 'user' && (
                        <div className="flex items-center gap-1 mb-1 opacity-70 text-xs">
                          <Paperclip className="w-3 h-3" />
                          <span>Attachments included</span>
                        </div>
                      )}
                      
                      {displayText && message.role === 'user' && (
                        <p className="whitespace-pre-wrap break-words">{displayText}</p>
                      )}
                      {displayText && message.role === 'assistant' && (
                        <>
                          {/* Render text with prompts extracted into code boxes */}
                          {(() => {
                            const prompts = extractPrompts(displayText)
                            let remainingText = displayText
                            
                            // If we found prompts, render them specially
                            if (prompts.length > 0) {
                              return (
                                <div className="space-y-3">
                                  {/* Regular text (remove the quoted prompts for cleaner display) */}
                                  <p className="whitespace-pre-wrap break-words">
                                    {remainingText
                                      .replace(/"[^"]{20,}"/g, '') // Remove long quoted text
                                      .replace(/```(?:prompt)?\n?[\s\S]*?```/g, '') // Remove code blocks
                                      .replace(/\n{3,}/g, '\n\n') // Clean up extra newlines
                                      .trim()}
                                  </p>
                                  
                                  {/* Prompt boxes */}
                                  {prompts.map((prompt, idx) => (
                                    <div 
                                      key={idx}
                                      className="relative group bg-black/20 dark:bg-white/5 border border-border/50 rounded-lg p-3 mt-2"
                                    >
                                      <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground/90 pr-16">
                                        {prompt}
                                      </pre>
                                      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => handleCopyPrompt(prompt)}
                                          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                          title="Copy prompt"
                                        >
                                          {copiedPrompt === prompt ? (
                                            <CheckIcon className="w-3.5 h-3.5 text-green-500" />
                                          ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                        {onSendPrompt && (
                                          <button
                                            onClick={() => handleSendPrompt(prompt)}
                                            className="p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                            title="Use this prompt"
                                          >
                                            <ArrowRight className="w-3.5 h-3.5 rotate-[135deg]" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                            
                            // No prompts found, render normally
                            return <p className="whitespace-pre-wrap break-words">{displayText}</p>
                          })()}
                        </>
                      )}
                      {!displayText && hasAttachments && (
                        <p className="opacity-70 italic">Sent attachments</p>
                      )}
                    </div>
                  </div>
                )
              })
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
          <div className="border-t border-border p-3 bg-card">
            {/* File previews */}
            {filePreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {filePreviews.map((item, index) => (
                  <div
                    key={index}
                    className="relative group"
                  >
                    {item.type === 'image' ? (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-border">
                        <img
                          src={item.preview}
                          alt={item.file.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted border border-border">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs truncate max-w-[100px]">{item.file.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <form onSubmit={onSubmit} className="flex gap-2">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.md"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {/* Input with attachment button inside and resize handle */}
              <div className="flex-1 relative">
                {/* Resize handle at top of input */}
                <div 
                  className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 cursor-ns-resize group"
                  onMouseDown={handleResizeStart}
                  onTouchStart={handleResizeStart}
                >
                  <div className={cn(
                    "flex items-center justify-center w-10 h-4 rounded-full transition-all",
                    isResizing 
                      ? "bg-primary/20 text-primary" 
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}>
                    <GripHorizontal className="w-4 h-3" />
                  </div>
                </div>
                
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="What would you like to explore?"
                  style={{ height: `${inputHeight}px` }}
                  className="resize-none rounded-xl text-sm py-3 pl-3 pr-10 overflow-y-auto"
                  disabled={isLoading}
                />
                {/* Attachment button inside input - right side, vertically centered */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
                  title="Attach files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>
              
              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 rounded-xl shrink-0"
                disabled={(!input.trim() && attachedFiles.length === 0) || !canSend}
              >
                {isLoading || isUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </form>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Drop files or click 📎 • Enter to send
            </p>
          </div>
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


