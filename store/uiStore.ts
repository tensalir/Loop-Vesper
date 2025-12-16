import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface GenerationParameters {
  aspectRatio: string
  resolution: number
  numOutputs: number
  duration?: number
}

interface UIState {
  // State
  selectedModel: string
  parameters: GenerationParameters
  
  // Actions
  setSelectedModel: (model: string) => void
  setParameters: (parameters: Partial<GenerationParameters>) => void
  resetParameters: () => void
}

const defaultParameters: GenerationParameters = {
  aspectRatio: '1:1',
  resolution: 1024,
  numOutputs: 4,
  duration: 8, // Default for video models
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        // Initial state
        selectedModel: 'gemini-nano-banana-pro',
        parameters: defaultParameters,

        // Actions
        setSelectedModel: (model) =>
          set({ selectedModel: model }, false, 'setSelectedModel'),

        setParameters: (newParams) =>
          set(
            (state) => ({
              parameters: { ...state.parameters, ...newParams },
            }),
            false,
            'setParameters'
          ),

        resetParameters: () =>
          set({ parameters: defaultParameters }, false, 'resetParameters'),
      }),
      {
        name: 'ui-storage', // localStorage key
        partialize: (state) => ({
          selectedModel: state.selectedModel,
          parameters: state.parameters,
        }),
      }
    ),
    { name: 'UIStore' }
  )
)

