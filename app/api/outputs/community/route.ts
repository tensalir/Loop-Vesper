import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// GET /api/outputs/community - Get latest prompts (generations) from all users
export async function GET(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '8'), 16)

    const stopwords = new Set([
      'a','an','and','are','as','at','be','by','for','from','in','into','is','it','its',
      'of','on','or','that','the','their','then','this','to','with','without','your',
    ])

    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const toTokenSet = (text: string) => {
      const tokens = normalize(text)
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stopwords.has(t))
      return new Set(tokens)
    }

    const jaccard = (a: Set<string>, b: Set<string>) => {
      if (a.size === 0 && b.size === 0) return 1
      if (a.size === 0 || b.size === 0) return 0
      let intersection = 0
      const [small, large] = a.size <= b.size ? [a, b] : [b, a]
      for (const token of small) {
        if (large.has(token)) intersection += 1
      }
      const union = a.size + b.size - intersection
      return union === 0 ? 0 : intersection / union
    }

    // Fetch latest *prompts* (generations) from shared projects, newest-first.
    // We return 1 output per generation so the feed represents distinct prompts.
    const poolSize = Math.min(Math.max(limit * 10, 64), 200)

    const recentGenerations = await prisma.generation.findMany({
      where: {
        status: 'completed',
        // Only include outputs from projects visible in the community feed.
        // (Project owner controls this with the lock/globe toggle.)
        session: {
          project: {
            isShared: true,
          },
        },
      },
      select: {
        id: true,
        prompt: true,
        modelId: true,
        parameters: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        outputs: {
          select: {
            id: true,
            fileUrl: true,
            fileType: true,
            width: true,
            height: true,
            duration: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: poolSize,
    })

    const creations: any[] = []
    const seenPromptNorms = new Set<string>()
    const seenFileUrls = new Set<string>()
    const selectedTokenSets: Set<string>[] = []
    const similarityThreshold = 0.72

    for (const g of recentGenerations) {
      if (creations.length >= limit) break

      const output = g.outputs[0]
      if (!output) continue

      if (seenFileUrls.has(output.fileUrl)) continue

      const promptNorm = normalize(g.prompt)
      if (promptNorm.length === 0) continue
      if (seenPromptNorms.has(promptNorm)) continue

      const tokenSet = toTokenSet(g.prompt)
      let tooSimilar = false
      for (const existing of selectedTokenSets) {
        if (jaccard(tokenSet, existing) >= similarityThreshold) {
          tooSimilar = true
          break
        }
      }
      if (tooSimilar) continue

      seenFileUrls.add(output.fileUrl)
      seenPromptNorms.add(promptNorm)
      selectedTokenSets.push(tokenSet)

      creations.push({
        id: output.id,
        fileUrl: output.fileUrl,
        fileType: output.fileType,
        width: output.width,
        height: output.height,
        duration: output.duration,
        createdAt: output.createdAt,
        generation: {
          id: g.id,
          prompt: g.prompt,
          modelId: g.modelId,
          parameters: g.parameters as any,
          createdAt: g.createdAt,
          user: g.user,
          session: g.session,
        },
      })
    }

    return NextResponse.json(creations, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Error fetching community outputs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch community outputs' },
      { status: 500 }
    )
  }
}
