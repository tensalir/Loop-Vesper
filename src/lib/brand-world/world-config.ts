export interface BannerSlot {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number]
}

export interface StageConfig {
  id: string
  name: string
  description: string
  position: [number, number, number]
  color: string
  bannerSlots: BannerSlot[]
}

export const WORLD_CONFIG = {
  groundSize: 80,
  cameraPosition: [40, 50, 40] as [number, number, number],
  cameraTarget: [0, 0, 0] as [number, number, number],
  ambientLightIntensity: 0.6,
  directionalLightIntensity: 0.8,
  directionalLightPosition: [20, 30, 10] as [number, number, number],
  fogColor: '#1a1a2e',
  fogNear: 60,
  fogFar: 120,
} as const

export const STAGES: StageConfig[] = [
  {
    id: 'main-stage',
    name: 'Main Stage',
    description: 'The primary festival stage for headline acts and keynote performances.',
    position: [0, 0, 0],
    color: '#e74c3c',
    bannerSlots: [
      { id: 'ms-banner-1', position: [-4, 3.5, -3], rotation: [0, 0.3, 0], size: [5, 3] },
      { id: 'ms-banner-2', position: [4, 3.5, -3], rotation: [0, -0.3, 0], size: [5, 3] },
      { id: 'ms-banner-3', position: [0, 5, -4], rotation: [0, 0, 0], size: [7, 4] },
    ],
  },
  {
    id: 'chill-zone',
    name: 'Chill Zone',
    description: 'A relaxed lounge area with ambient visuals and laid-back vibes.',
    position: [-20, 0, -15],
    color: '#3498db',
    bannerSlots: [
      { id: 'cz-banner-1', position: [-3, 2.5, -2], rotation: [0, 0.5, 0], size: [4, 2.5] },
      { id: 'cz-banner-2', position: [3, 2.5, -2], rotation: [0, -0.5, 0], size: [4, 2.5] },
    ],
  },
  {
    id: 'dance-arena',
    name: 'Dance Arena',
    description: 'High-energy dance floor with dynamic visuals and heavy bass.',
    position: [22, 0, -10],
    color: '#9b59b6',
    bannerSlots: [
      { id: 'da-banner-1', position: [-3.5, 3, -2.5], rotation: [0, 0.4, 0], size: [4.5, 3] },
      { id: 'da-banner-2', position: [3.5, 3, -2.5], rotation: [0, -0.4, 0], size: [4.5, 3] },
      { id: 'da-banner-3', position: [0, 4.5, -3.5], rotation: [0, 0, 0], size: [6, 3.5] },
    ],
  },
  {
    id: 'food-village',
    name: 'Food Village',
    description: 'Festival food court with vendor stalls and communal seating.',
    position: [-15, 0, 18],
    color: '#f39c12',
    bannerSlots: [
      { id: 'fv-banner-1', position: [0, 2, -2], rotation: [0, 0, 0], size: [4, 2] },
    ],
  },
  {
    id: 'brand-pavilion',
    name: 'Brand Pavilion',
    description: 'Loop Earplugs showcase area with product displays and brand activations.',
    position: [15, 0, 20],
    color: '#1abc9c',
    bannerSlots: [
      { id: 'bp-banner-1', position: [-3, 3, -2], rotation: [0, 0.3, 0], size: [4, 3] },
      { id: 'bp-banner-2', position: [3, 3, -2], rotation: [0, -0.3, 0], size: [4, 3] },
      { id: 'bp-banner-3', position: [0, 5, -3], rotation: [0, 0, 0], size: [6, 3] },
    ],
  },
]

export function getAllBannerSlots(): Array<BannerSlot & { stageId: string }> {
  return STAGES.flatMap((stage) =>
    stage.bannerSlots.map((slot) => ({ ...slot, stageId: stage.id }))
  )
}

export function getStageById(id: string): StageConfig | undefined {
  return STAGES.find((s) => s.id === id)
}
