export interface BannerSlot {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  size: [number, number]
}

export interface StageConfig {
  id: string
  name: string
  sessionPrefix: string
  description: string
  position: [number, number, number]
  color: string
  scale: number
  bannerSlots: BannerSlot[]
}

export const WORLD_CONFIG = {
  groundSize: 200,
  cameraPosition: [40, 50, 40] as [number, number, number],
  cameraTarget: [0, 0, -5] as [number, number, number],
  ambientLightIntensity: 0.55,
  directionalLightIntensity: 1.0,
  directionalLightPosition: [30, 50, 20] as [number, number, number],
  fogColor: '#b8d4e8',
  fogNear: 100,
  fogFar: 250,
  skyZenithColor: '#3a8fd4',
  skyHorizonColor: '#c8e0f0',
  skyMidColor: '#6bb3e0',
} as const

export const STAGES: StageConfig[] = [
  {
    id: 'main-stage',
    name: 'Main Stage',
    sessionPrefix: 'Main Stage',
    description: 'The primary festival stage for headline acts and keynote performances.',
    position: [0, 0, -30],
    color: '#e74c3c',
    scale: 2.5,
    bannerSlots: [
      { id: 'ms-banner-1', position: [-8, 7, -6], rotation: [0, 0.3, 0], size: [8, 5] },
      { id: 'ms-banner-2', position: [8, 7, -6], rotation: [0, -0.3, 0], size: [8, 5] },
      { id: 'ms-banner-3', position: [0, 11, -8], rotation: [0, 0, 0], size: [12, 6] },
    ],
  },
  {
    id: 'chill-zone',
    name: 'Chill Zone',
    sessionPrefix: 'Chill Zone',
    description: 'A relaxed lounge area with ambient visuals and laid-back vibes.',
    position: [-22, 0, -8],
    color: '#3498db',
    scale: 1,
    bannerSlots: [
      { id: 'cz-banner-1', position: [-3, 2.5, -2], rotation: [0, 0.5, 0], size: [4, 2.5] },
      { id: 'cz-banner-2', position: [3, 2.5, -2], rotation: [0, -0.5, 0], size: [4, 2.5] },
    ],
  },
  {
    id: 'dance-arena',
    name: 'Dance Arena',
    sessionPrefix: 'Dance Arena',
    description: 'High-energy dance floor with dynamic visuals and heavy bass.',
    position: [24, 0, -5],
    color: '#9b59b6',
    scale: 1,
    bannerSlots: [
      { id: 'da-banner-1', position: [-3.5, 3, -2.5], rotation: [0, 0.4, 0], size: [4.5, 3] },
      { id: 'da-banner-2', position: [3.5, 3, -2.5], rotation: [0, -0.4, 0], size: [4.5, 3] },
      { id: 'da-banner-3', position: [0, 4.5, -3.5], rotation: [0, 0, 0], size: [6, 3.5] },
    ],
  },
  {
    id: 'food-village',
    name: 'Food Village',
    sessionPrefix: 'Food Village',
    description: 'Festival food court with vendor stalls and communal seating.',
    position: [-15, 0, 18],
    color: '#f39c12',
    scale: 0.85,
    bannerSlots: [
      { id: 'fv-banner-1', position: [0, 2, -2], rotation: [0, 0, 0], size: [4, 2] },
    ],
  },
  {
    id: 'brand-pavilion',
    name: 'Brand Pavilion',
    sessionPrefix: 'Brand Pavilion',
    description: 'Loop Earplugs showcase area with product displays and brand activations.',
    position: [18, 0, 20],
    color: '#1abc9c',
    scale: 1.1,
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

export function zoneSessionName(prefix: string, type: 'image' | 'video'): string {
  return `${prefix} - ${type === 'image' ? 'Images' : 'Videos'}`
}

export function stageIdFromSessionName(sessionName: string): string | null {
  for (const stage of STAGES) {
    if (sessionName.startsWith(stage.sessionPrefix + ' - ')) {
      return stage.id
    }
  }
  return null
}
