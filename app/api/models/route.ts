import { NextRequest, NextResponse } from 'next/server'
import { getAllModels, getModelsByType } from '@/lib/models/registry'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') as 'image' | 'video' | null

    const models = type ? getModelsByType(type) : getAllModels()

    return NextResponse.json({ models }, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (error: any) {
    console.error('Models API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch models' },
      { status: 500 }
    )
  }
}

