import { useMutation, useQueryClient, InfiniteData } from '@tanstack/react-query'
import type { GenerationWithOutputs } from '@/types/generation'

interface PaginatedGenerationsResponse {
  data: GenerationWithOutputs[]
  nextCursor?: string
  hasMore: boolean
}

interface GenerateParams {
  sessionId: string
  modelId: string
  prompt: string
  negativePrompt?: string
  parameters: {
    aspectRatio: string
    resolution: number
    numOutputs: number
    duration?: number
    referenceImage?: string
    referenceImageId?: string
    /** Links this video generation to a source image output (for animate-still) */
    sourceOutputId?: string
  }
}

interface GenerateResponse {
  id: string
  status: 'processing' | 'completed' | 'failed'
  outputs?: Array<{
    url: string
    width?: number
    height?: number
    duration?: number
  }>
  error?: string
  message?: string
  predictionId?: string // Present when webhook-based generation is used
}

async function generateImage(params: GenerateParams): Promise<GenerateResponse> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`
    try {
      const errorData = await response.json()
      errorMessage = errorData.error || errorData.message || errorMessage
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
  return data
}

export function useGenerateMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: generateImage,
    onMutate: async (variables) => {
      // Cancel both caches to prevent race conditions
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['generations', variables.sessionId] }),
        queryClient.cancelQueries({ queryKey: ['generations', 'infinite', variables.sessionId] }),
      ])

      // Snapshot the previous values for rollback
      const previousGenerations = queryClient.getQueryData<GenerationWithOutputs[]>([
        'generations',
        variables.sessionId,
      ])
      const previousInfiniteGenerations = queryClient.getQueryData<InfiniteData<PaginatedGenerationsResponse>>([
        'generations',
        'infinite',
        variables.sessionId,
      ])

      // Create optimistic generation with a stable clientId for React keys
      // The clientId persists even when the real id replaces the temp id
      const timestamp = Date.now()
      const clientId = `client-${timestamp}`
      const optimisticGeneration: GenerationWithOutputs = {
        id: `temp-${timestamp}`,
        clientId, // Stable key for React to prevent remount flicker
        sessionId: variables.sessionId,
        userId: '',
        modelId: variables.modelId,
        prompt: variables.prompt,
        negativePrompt: variables.negativePrompt,
        parameters: variables.parameters,
        status: 'processing',
        createdAt: new Date(),
        outputs: [],
      }
      
      // Store the optimistic ID and clientId in context for later matching
      const optimisticId = optimisticGeneration.id

      // Add pending generation to regular cache
      queryClient.setQueryData<GenerationWithOutputs[]>(
        ['generations', variables.sessionId],
        (old) => {
          if (!old) return [optimisticGeneration]
          const exists = old.some(gen => gen.id === optimisticGeneration.id || gen.clientId === clientId)
          if (exists) return old
          return [...old, optimisticGeneration]
        }
      )
      
      // Update the infinite query cache
      // API returns newest-first, so insert at START of page 0
      queryClient.setQueryData(
        ['generations', 'infinite', variables.sessionId],
        (old: InfiniteData<PaginatedGenerationsResponse> | undefined) => {
          // If cache is empty/undefined, initialize it with a first page
          if (!old || !old.pages.length) {
            return {
              pageParams: [undefined],
              pages: [{
                data: [optimisticGeneration],
                nextCursor: undefined,
                hasMore: false,
              }],
            }
          }
          
          // Insert at START of page 0 (newest-first order)
          return {
            ...old,
            pages: old.pages.map((page, pageIndex) => {
              if (pageIndex === 0) {
                const exists = page.data.some(gen => gen.id === optimisticGeneration.id || gen.clientId === clientId)
                if (exists) return page
                // Insert at START (newest items first in API response)
                return { ...page, data: [optimisticGeneration, ...page.data] }
              }
              return page
            }),
          }
        }
      )

      // Return context with previous state for rollback
      return { previousGenerations, previousInfiniteGenerations, optimisticId, clientId }
    },
    onSuccess: (data, variables, context) => {
      console.log(`[${data.id}] Generation mutation success - status: ${data.status}`)
      
      // If status is 'processing', trigger the background process endpoint from frontend
      // This is a fallback in case the server-side trigger fails (Vercel limitation)
      // SKIP if predictionId is present - means webhook was used, no fallback needed
      if (data.predictionId) {
        console.log(`[${data.id}] Webhook-based generation - skipping frontend fallback (prediction: ${data.predictionId})`)
      }
      if (data.status === 'processing' && !data.predictionId) {
        // Trigger background process with retry logic
        const triggerWithRetry = async (retries = 3, delay = 500) => {
          for (let attempt = 1; attempt <= retries; attempt++) {
            try {
              await new Promise(resolve => setTimeout(resolve, delay * attempt))
              console.log(`[${data.id}] Frontend fallback: Triggering background process (attempt ${attempt}/${retries})`)
              
              const res = await fetch('/api/generate/process', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include', // Ensure cookies are sent
                body: JSON.stringify({
                  generationId: data.id,
                }),
              })
              
              if (res.ok) {
                console.log(`[${data.id}] Frontend trigger successful`)
                return // Success, exit retry loop
              } else {
                const errorText = await res.text()
                console.warn(`[${data.id}] Frontend trigger failed (attempt ${attempt}): ${res.status} ${errorText}`)
                
                // If it's a 401, the session might have expired - don't retry
                if (res.status === 401) {
                  console.error(`[${data.id}] Authentication failed - session may have expired. Stopping retries.`)
                  return
                }
                
                // Retry on other errors (network issues, 500s, etc.)
                if (attempt < retries) {
                  console.log(`[${data.id}] Will retry in ${delay * (attempt + 1)}ms...`)
                  continue
                } else {
                  console.error(`[${data.id}] All ${retries} attempts exhausted. Generation may be stuck.`)
                }
              }
            } catch (err) {
              console.error(`[${data.id}] Frontend trigger error (attempt ${attempt}):`, err)
              if (attempt === retries) {
                console.error(`[${data.id}] All frontend trigger attempts failed`)
              }
            }
          }
        }
        
        // Start the retry process (don't await - fire and forget)
        triggerWithRetry().catch((err) => {
          console.error(`[${data.id}] Frontend trigger retry process failed:`, err)
        })
      }
      
      // Helper to create the updated generation object
      // Preserves clientId for stable React keys
      const createUpdatedGeneration = (original: GenerationWithOutputs): GenerationWithOutputs => {
        const base = {
          ...original,
          id: data.id,
          clientId: context?.clientId || original.clientId, // Preserve stable key
        }
        
        if (data.status === 'processing') {
          return {
            ...base,
            status: 'processing' as const,
          }
        } else if (data.status === 'completed' && data.outputs) {
          return {
            ...base,
            status: 'completed' as const,
            outputs: data.outputs.map((output, index) => ({
              id: `${data.id}-${index}`,
              generationId: data.id,
              fileUrl: output.url,
              fileType: 'image' as const,
              width: output.width,
              height: output.height,
              duration: output.duration,
              isStarred: false,
              createdAt: new Date(),
            })),
          }
        } else if (data.status === 'failed') {
          return {
            ...base,
            status: 'failed' as const,
            parameters: {
              ...original.parameters,
              error: data.error,
            },
          }
        }
        return base
      }
      
      // Update the regular generations cache
      // Match by either optimisticId or clientId for robustness
      queryClient.setQueryData<GenerationWithOutputs[]>(
        ['generations', variables.sessionId],
        (old) => {
          if (!old) return []
          return old.map((gen) => {
            if (gen.id === context?.optimisticId || gen.clientId === context?.clientId) {
              console.log('✓ Replacing optimistic generation:', context?.optimisticId, '→', data.id)
              return createUpdatedGeneration(gen)
            }
            return gen
          })
        }
      )
      
      // Update the infinite generations cache
      // Match by either optimisticId or clientId for robustness
      queryClient.setQueryData(
        ['generations', 'infinite', variables.sessionId],
        (old: InfiniteData<PaginatedGenerationsResponse> | undefined) => {
          if (!old) return undefined
          
          return {
            ...old,
            pages: old.pages.map((page) => {
              const foundIndex = page.data.findIndex(
                gen => gen.id === context?.optimisticId || gen.clientId === context?.clientId
              )
              if (foundIndex !== -1) {
                console.log('✓ Replacing optimistic generation in infinite cache:', context?.optimisticId, '→', data.id)
                const newData = [...page.data]
                newData[foundIndex] = createUpdatedGeneration(newData[foundIndex])
                return { ...page, data: newData }
              }
              return page
            }),
          }
        }
      )
      
      // DON'T invalidate - rely on optimistic updates, real-time subscriptions, and polling
      // This prevents the race condition where invalidation refetches and overwrites the processing state
    },
    onError: (error: Error, variables, context) => {
      console.error('Generation failed:', error)
      
      // Helper to create failed generation with preserved clientId
      const createFailedGeneration = (gen: GenerationWithOutputs): GenerationWithOutputs => ({
        ...gen,
        clientId: context?.clientId || gen.clientId, // Preserve stable key
        status: 'failed' as const,
        parameters: {
          ...gen.parameters,
          error: error.message,
        },
      })
      
      // Update the optimistic generation to show the error in both caches
      // Match by either optimisticId or clientId for robustness
      queryClient.setQueryData<GenerationWithOutputs[]>(
        ['generations', variables.sessionId],
        (old) => {
          if (!old) return []
          
          return old.map((gen) => {
            if (gen.id === context?.optimisticId || gen.clientId === context?.clientId) {
              return createFailedGeneration(gen)
            }
            return gen
          })
        }
      )
      
      // Also update the infinite query cache so errors persist
      queryClient.setQueryData(
        ['generations', 'infinite', variables.sessionId],
        (old: InfiniteData<PaginatedGenerationsResponse> | undefined) => {
          if (!old) return undefined
          
          return {
            ...old,
            pages: old.pages.map((page) => {
              const foundIndex = page.data.findIndex(
                gen => gen.id === context?.optimisticId || gen.clientId === context?.clientId
              )
              if (foundIndex !== -1) {
                const newData = [...page.data]
                newData[foundIndex] = createFailedGeneration(newData[foundIndex])
                return { ...page, data: newData }
              }
              return page
            }),
          }
        }
      )
    },
  })
}

