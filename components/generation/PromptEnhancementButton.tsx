'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Wand2, Loader2 } from 'lucide-react'

interface PromptEnhancementButtonProps {
  prompt: string
  modelId: string
  referenceImage?: string | File | null
  onEnhancementComplete: (enhancedPrompt: string) => void
  onEnhancingChange?: (isEnhancing: boolean) => void
  onTextTransform?: (transformedText: string) => void
  disabled?: boolean
  className?: string
}

// Glitch characters for scramble effect
const GLITCH_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?~`░▒▓█▄▀■□▪▫●○◆◇★☆'

// Helper function to create a glitch/scramble effect during transformation
function morphText(original: string, enhanced: string, progress: number): string {
  if (progress <= 0) return original
  if (progress >= 1) return enhanced
  
  // Three phases:
  // Phase 1 (0-0.3): Original text with increasing glitch
  // Phase 2 (0.3-0.7): Heavy glitch transition
  // Phase 3 (0.7-1): Enhanced text emerging from glitch
  
  const chars = enhanced.split('')
  const originalChars = original.split('')
  const maxLen = Math.max(chars.length, originalChars.length)
  
  const result: string[] = []
  
  for (let i = 0; i < maxLen; i++) {
    const enhancedChar = chars[i] || ''
    const originalChar = originalChars[i] || ''
    
    // Calculate character-specific progress (wave effect from start to end)
    const charProgress = Math.max(0, Math.min(1, (progress * 1.5) - (i / maxLen) * 0.5))
    
    if (charProgress < 0.2) {
      // Still original
      result.push(originalChar)
    } else if (charProgress < 0.4) {
      // Glitching - random chance to show glitch char
      if (Math.random() < 0.6) {
        result.push(GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)])
      } else {
        result.push(originalChar)
      }
    } else if (charProgress < 0.7) {
      // Heavy glitch
      if (Math.random() < 0.8) {
        result.push(GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)])
      } else if (Math.random() < 0.5) {
        result.push(enhancedChar)
      } else {
        result.push(originalChar)
      }
    } else if (charProgress < 0.9) {
      // Emerging - mostly enhanced with some glitch
      if (Math.random() < 0.3) {
        result.push(GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)])
      } else {
        result.push(enhancedChar)
      }
    } else {
      // Final - enhanced character
      result.push(enhancedChar)
    }
  }
  
  return result.join('')
}

export function PromptEnhancementButton({
  prompt,
  modelId,
  referenceImage,
  onEnhancementComplete,
  onEnhancingChange,
  onTextTransform,
  disabled = false,
}: PromptEnhancementButtonProps) {
  const [loading, setLoading] = useState(false)
  const [enhancing, setEnhancing] = useState(false)

  // Notify parent when enhancing state changes
  useEffect(() => {
    onEnhancingChange?.(enhancing)
  }, [enhancing, onEnhancingChange])

  const handleEnhance = async () => {
    if (!prompt.trim() || loading) return

    setLoading(true)
    setEnhancing(true)
    
    try {
      // Convert reference image to base64 if it's a File
      // COMPRESS to prevent HTTP 413 errors (Vercel limit: 4.5MB)
      let imageData = null
      if (referenceImage) {
        if (referenceImage instanceof File) {
          // Compress the image before sending
          imageData = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              
              // Check size and compress if necessary
              const img = new Image()
              img.onload = () => {
                const canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')
                
                if (!ctx) {
                  resolve(dataUrl) // Fallback to original if canvas not supported
                  return
                }
                
                // Calculate new dimensions (max 1024px for faster processing)
                let { width, height } = img
                if (width > 1024 || height > 1024) {
                  const ratio = 1024 / Math.max(width, height)
                  width = Math.floor(width * ratio)
                  height = Math.floor(height * ratio)
                }
                
                canvas.width = width
                canvas.height = height
                ctx.drawImage(img, 0, 0, width, height)
                
                // Convert to JPEG at 80% quality
                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
                
                // Final size check - reject if still too large
                const sizeInMB = compressedDataUrl.length / (1024 * 1024)
                if (sizeInMB > 2) {
                  console.warn('Compressed image still too large for enhancement, skipping image in enhancement')
                  resolve('') // Send without image if still too large
                } else {
                  resolve(compressedDataUrl)
                }
              }
              img.onerror = () => resolve(dataUrl) // Fallback on error
              img.src = dataUrl
            }
            reader.onerror = () => resolve('')
            reader.readAsDataURL(referenceImage)
          })
        } else if (typeof referenceImage === 'string') {
          // Already compressed base64, use as-is
          const sizeInMB = referenceImage.length / (1024 * 1024)
          if (sizeInMB > 2) {
            console.warn('Reference image too large for enhancement, skipping')
            imageData = null // Skip image if too large
          } else {
            imageData = referenceImage
          }
        }
      }
      
      const response = await fetch('/api/prompts/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          modelId,
          referenceImage: imageData,
        }),
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        try {
          const error = await response.json()
          errorMessage = error.error || error.message || errorMessage
        } catch {
          // If response is not JSON, try to get text
          try {
            const text = await response.text()
            errorMessage = text || errorMessage
          } catch {
            // Last resort: use status
          }
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const enhancedPrompt = data.enhancedPrompt
      
      // Gradually transform the text with glitch effect
      const startTime = Date.now()
      const duration = 1500 // 1.5 seconds for transformation
      const steps = 50 // More steps for smoother glitch effect
      const stepDuration = duration / steps
      
      let currentStep = 0
      const transformInterval = setInterval(() => {
        currentStep++
        const progress = Math.min(currentStep / steps, 1)
        const transformedText = morphText(prompt, enhancedPrompt, progress)
        
        // Update the text during transformation
        onTextTransform?.(transformedText)
        
        if (progress >= 1) {
          clearInterval(transformInterval)
          // Final update with complete enhanced text
          onEnhancementComplete(enhancedPrompt)
          // Stop enhancing state after transformation completes
          setTimeout(() => setEnhancing(false), 200)
        }
      }, stepDuration)
    } catch (error: any) {
      console.error('Error enhancing prompt:', error)
      setEnhancing(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleEnhance}
        disabled={disabled || !prompt.trim() || loading}
        className="absolute right-3 top-3 h-6 w-6 text-primary hover:text-primary/80 transition-colors disabled:opacity-0 disabled:pointer-events-none"
        title="Enhance prompt with AI"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wand2 className="h-4 w-4" />
        )}
      </Button>
    </>
  )
}

