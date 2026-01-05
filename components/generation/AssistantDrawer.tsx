'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, MessageSquare, Sparkles, Loader2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface GenerationContext {
  currentPrompt?: string
  selectedModel?: string
  generationType?: 'image' | 'video'
  referenceImageCount?: number
}

interface AssistantDrawerProps {
  isOpen: boolean
  onClose: () => void
  context?: GenerationContext
  onApplyPrompt?: (prompt: string) => void
}

/**
 * Extract prompts from assistant messages
 * Looks for backtick-wrapped prompts or the entire message if no backticks
 */
function extractPrompts(content: string): string[] {
  const backtickMatches = content.match(/`([^`]+)`/g)
  if (backtickMatches) {
    return backtickMatches.map(m => m.slice(1, -1))
  }
  return []
}

export function AssistantDrawer({ isOpen, onClose, context, onApplyPrompt }: AssistantDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Build message history for API
      const messageHistory = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messageHistory,
          context,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to get response')
      }

      const data = await response.json()
      
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.message.content,
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error: any) {
      console.error('Assistant error:', error)
      toast({
        title: 'Assistant Error',
        description: error.message || 'Failed to get response',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, context, toast])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleApplyPrompt = (prompt: string) => {
    if (onApplyPrompt) {
      onApplyPrompt(prompt)
      toast({
        title: 'Prompt Applied',
        description: 'The suggested prompt has been applied to your input.',
      })
    }
  }

  const handleCopyPrompt = async (prompt: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopiedMessageId(messageId)
      setTimeout(() => setCopiedMessageId(null), 2000)
    } catch {
      toast({
        title: 'Copy Failed',
        description: 'Could not copy to clipboard',
        variant: 'destructive',
      })
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-background border-l border-border shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Assistant</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="text-xs text-muted-foreground"
            >
              Clear
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mb-3 text-primary/50" />
            <p className="font-medium mb-1">How can I help?</p>
            <p className="text-sm">
              Ask me about prompts, models, or best practices for AI generation.
            </p>
            {context?.currentPrompt && (
              <p className="text-xs mt-3 px-4 py-2 bg-muted rounded-lg">
                I can see your current prompt. Ask me to improve it!
              </p>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                
                {/* Show apply/copy buttons for assistant messages with prompts */}
                {message.role === 'assistant' && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {extractPrompts(message.content).map((prompt, idx) => (
                      <div key={idx} className="flex gap-1">
                        {onApplyPrompt && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => handleApplyPrompt(prompt)}
                          >
                            Apply
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => handleCopyPrompt(prompt, `${message.id}-${idx}`)}
                        >
                          {copiedMessageId === `${message.id}-${idx}` ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about prompts or models..."
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="h-[60px]"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

