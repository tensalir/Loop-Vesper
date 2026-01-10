'use client'

import { useEffect, useRef, useState } from 'react'
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

function approxDataUrlSizeMB(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || ''
  // base64 length -> bytes: len * 3/4 (approx, ignoring padding)
  const bytes = Math.floor((base64.length * 3) / 4)
  return bytes / (1024 * 1024)
}

async function compressImageBlobToJpegDataUrl(
  blob: Blob,
  {
    maxDimension = 1024,
    maxSizeMB = 2,
    initialQuality = 0.82,
    minQuality = 0.5,
    maxAttempts = 4,
  }: {
    maxDimension?: number
    maxSizeMB?: number
    initialQuality?: number
    minQuality?: number
    maxAttempts?: number
  } = {}
): Promise<string | null> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Calculate new dimensions (preserve aspect ratio)
    let { width, height } = img
    if (width > maxDimension || height > maxDimension) {
      const ratio = maxDimension / Math.max(width, height)
      width = Math.floor(width * ratio)
      height = Math.floor(height * ratio)
    }

    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)

    let quality = initialQuality
    let dataUrl = canvas.toDataURL('image/jpeg', quality)
    let attempts = 0

    while (approxDataUrlSizeMB(dataUrl) > maxSizeMB && attempts < maxAttempts && quality > minQuality) {
      attempts += 1
      quality = Math.max(minQuality, quality - 0.1)
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    }

    if (approxDataUrlSizeMB(dataUrl) > maxSizeMB) {
      return null
    }

    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function referenceImageToCompressedDataUrl(
  referenceImage: string | File
): Promise<string | null> {
  try {
    let blob: Blob

    if (referenceImage instanceof File) {
      blob = referenceImage
    } else if (typeof referenceImage === 'string') {
      // Accept data URLs, blob URLs, or http(s) URLs
      if (
        !referenceImage.startsWith('data:') &&
        !referenceImage.startsWith('blob:') &&
        !referenceImage.startsWith('http')
      ) {
        return null
      }
      const res = await fetch(referenceImage)
      if (!res.ok) return null
      blob = await res.blob()
    } else {
      return null
    }

    return await compressImageBlobToJpegDataUrl(blob)
  } catch {
    return null
  }
}

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

  const transformIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopEnhancingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup intervals/timeouts on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (transformIntervalRef.current) {
        clearInterval(transformIntervalRef.current)
        transformIntervalRef.current = null
      }
      if (stopEnhancingTimeoutRef.current) {
        clearTimeout(stopEnhancingTimeoutRef.current)
        stopEnhancingTimeoutRef.current = null
      }
    }
  }, [])

  const handleEnhance = async () => {
    if (!prompt.trim() || loading || enhancing) return

    setLoading(true)
    setEnhancing(true)
    // IMPORTANT: Propagate enhancing state synchronously so parents can
    // immediately disable Generate and avoid submitting a stale prompt.
    onEnhancingChange?.(true)
    
    try {
      // Convert reference image (File/URL/dataUrl) to a compressed base64 data URL
      // to avoid request size issues and to reliably pass an actual image to the API.
      const imageData = referenceImage ? await referenceImageToCompressedDataUrl(referenceImage) : null
      
      const response = await fetch('/api/prompts/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          modelId,
          referenceImage: imageData || null,
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
      if (transformIntervalRef.current) {
        clearInterval(transformIntervalRef.current)
        transformIntervalRef.current = null
      }
      transformIntervalRef.current = setInterval(() => {
        currentStep++
        const progress = Math.min(currentStep / steps, 1)
        const transformedText = morphText(prompt, enhancedPrompt, progress)
        
        // Update the text during transformation
        onTextTransform?.(transformedText)
        
        if (progress >= 1) {
          if (transformIntervalRef.current) {
            clearInterval(transformIntervalRef.current)
            transformIntervalRef.current = null
          }
          // Final update with complete enhanced text
          onEnhancementComplete(enhancedPrompt)
          // Stop enhancing state after transformation completes
          if (stopEnhancingTimeoutRef.current) {
            clearTimeout(stopEnhancingTimeoutRef.current)
            stopEnhancingTimeoutRef.current = null
          }
          stopEnhancingTimeoutRef.current = setTimeout(() => {
            setEnhancing(false)
            onEnhancingChange?.(false)
          }, 200)
        }
      }, stepDuration)
    } catch (error: any) {
      console.error('Error enhancing prompt:', error)
      setEnhancing(false)
      onEnhancingChange?.(false)
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
        disabled={disabled || !prompt.trim() || loading || enhancing}
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

