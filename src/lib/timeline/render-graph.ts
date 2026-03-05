/**
 * Timeline render graph — builds an FFmpeg filter_complex specification
 * from a frozen timeline snapshot.
 *
 * Designed to run on a dedicated render worker (NOT inside a Vercel function).
 * The Vercel-side endpoint only enqueues the job; this logic runs server-side
 * in a long-running process with access to FFmpeg.
 *
 * V2 operations:
 *   - per-track clip trim + concat/xfade (dissolves scoped to same track)
 *   - multi-track overlay compositing (tracks stacked by sortOrder)
 *   - caption burn-in (drawtext filter)
 *   - multi-audio track mix (amix)
 *   - H.264 / AAC output
 */

interface RenderClip {
  id: string
  fileUrl: string
  fileType: 'video' | 'image' | 'audio'
  startMs: number
  endMs: number
  inPointMs: number
  outPointMs: number
}

interface RenderTransition {
  type: 'cross_dissolve'
  fromClipId: string
  toClipId: string
  durationMs: number
}

interface RenderCaption {
  text: string
  startMs: number
  endMs: number
  style: {
    fontSize: number
    color: string
    position: 'bottom' | 'top' | 'center'
  }
}

export interface RenderPlan {
  inputs: string[]
  filterComplex: string
  outputArgs: string[]
  totalDurationMs: number
}

export interface TimelineSnapshot {
  id: string
  durationMs: number
  fps: number
  tracks: Array<{
    kind: string
    sortOrder?: number
    clips: RenderClip[]
    captions?: RenderCaption[]
  }>
  transitions: RenderTransition[]
}

export function buildRenderPlan(
  snapshot: TimelineSnapshot,
  resolution: number = 1080
): RenderPlan {
  const inputs: string[] = []
  const filters: string[] = []
  let inputIndex = 0

  // Group video tracks by sortOrder (lowest = bottom layer)
  const videoTracks = snapshot.tracks
    .filter((t) => t.kind === 'video' && t.clips.length > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  const audioClips = snapshot.tracks
    .filter((t) => t.kind === 'audio')
    .flatMap((t) => t.clips)
    .sort((a, b) => a.startMs - b.startMs)

  const captions = snapshot.tracks
    .filter((t) => t.kind === 'caption')
    .flatMap((t) => t.captions ?? [])
    .sort((a, b) => a.startMs - b.startMs)

  const clipInputMap = new Map<string, number>()
  const allVideoClips = videoTracks.flatMap((t) => t.clips)
  for (const clip of allVideoClips) {
    clipInputMap.set(clip.id, inputIndex)
    inputs.push(clip.fileUrl)
    inputIndex++
  }

  const audioInputMap = new Map<string, number>()
  for (const clip of audioClips) {
    audioInputMap.set(clip.id, inputIndex)
    inputs.push(clip.fileUrl)
    inputIndex++
  }

  // Build per-track video chains with scoped dissolves
  const trackOutputLabels: string[] = []

  for (let tIdx = 0; tIdx < videoTracks.length; tIdx++) {
    const track = videoTracks[tIdx]
    const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs)
    const trackLabel = `track${tIdx}`

    for (const clip of clips) {
      const idx = clipInputMap.get(clip.id)!
      const trimStart = clip.inPointMs / 1000
      const trimEnd = clip.outPointMs / 1000
      filters.push(
        `[${idx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,scale=-2:${resolution}[v${idx}]`
      )
    }

    if (clips.length === 1) {
      filters.push(`[v${clipInputMap.get(clips[0].id)}]null[${trackLabel}]`)
    } else {
      let currentLabel = `v${clipInputMap.get(clips[0].id)}`
      for (let i = 1; i < clips.length; i++) {
        const nextLabel = `v${clipInputMap.get(clips[i].id)}`
        const isLast = i === clips.length - 1
        const outputLabel = isLast ? trackLabel : `${trackLabel}mix${i}`

        const transition = snapshot.transitions.find(
          (t) => t.fromClipId === clips[i - 1].id && t.toClipId === clips[i].id
        )

        if (transition) {
          const offsetSec = (clips[i].startMs - clips[i - 1].startMs) / 1000 - transition.durationMs / 1000
          filters.push(
            `[${currentLabel}][${nextLabel}]xfade=transition=fade:duration=${transition.durationMs / 1000}:offset=${Math.max(0, offsetSec)}[${outputLabel}]`
          )
        } else {
          filters.push(`[${currentLabel}][${nextLabel}]concat=n=2:v=1:a=0[${outputLabel}]`)
        }
        currentLabel = outputLabel
      }
    }

    trackOutputLabels.push(trackLabel)
  }

  // Composite stacked tracks via overlay (bottom track first, subsequent tracks overlay on top)
  if (trackOutputLabels.length === 0) {
    // No video — create black background
    filters.push(`color=c=black:s=1920x${resolution}:d=${snapshot.durationMs / 1000}[vout]`)
  } else if (trackOutputLabels.length === 1) {
    filters.push(`[${trackOutputLabels[0]}]null[vout]`)
  } else {
    let baseLabel = trackOutputLabels[0]
    for (let i = 1; i < trackOutputLabels.length; i++) {
      const overlayLabel = trackOutputLabels[i]
      const isLast = i === trackOutputLabels.length - 1
      const outputLabel = isLast ? 'vout' : `vstack${i}`
      filters.push(
        `[${baseLabel}][${overlayLabel}]overlay=eof_action=pass:shortest=0[${outputLabel}]`
      )
      baseLabel = outputLabel
    }
  }

  // Caption burn-in
  if (captions.length > 0 && trackOutputLabels.length > 0) {
    let captionInput = 'vout'
    for (let i = 0; i < captions.length; i++) {
      const cap = captions[i]
      const outputLabel = i === captions.length - 1 ? 'vcap' : `vcap${i}`
      const yPos = cap.style.position === 'top' ? '40' : cap.style.position === 'center' ? '(h-text_h)/2' : 'h-text_h-40'
      const escapedText = cap.text.replace(/'/g, "\\'").replace(/:/g, '\\:')
      filters.push(
        `[${captionInput}]drawtext=text='${escapedText}':fontsize=${cap.style.fontSize}:fontcolor=${cap.style.color}:x=(w-text_w)/2:y=${yPos}:enable='between(t,${cap.startMs / 1000},${cap.endMs / 1000})'[${outputLabel}]`
      )
      captionInput = outputLabel
    }
  }

  // Audio mixing
  if (audioClips.length > 0) {
    for (const clip of audioClips) {
      const idx = audioInputMap.get(clip.id)!
      const trimStart = clip.inPointMs / 1000
      const trimEnd = clip.outPointMs / 1000
      filters.push(
        `[${idx}:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[a${idx}]`
      )
    }

    if (audioClips.length === 1) {
      filters.push(`[a${audioInputMap.get(audioClips[0].id)}]anull[aout]`)
    } else {
      const audioLabels = audioClips.map((c) => `[a${audioInputMap.get(c.id)}]`).join('')
      filters.push(`${audioLabels}amix=inputs=${audioClips.length}:duration=longest[aout]`)
    }
  }

  const videoOutput = captions.length > 0 && trackOutputLabels.length > 0 ? 'vcap' : 'vout'
  const hasAudio = audioClips.length > 0

  const outputArgs = [
    '-map', `[${videoOutput}]`,
    ...(hasAudio ? ['-map', '[aout]'] : []),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []),
    '-movflags', '+faststart',
    '-r', String(snapshot.fps),
  ]

  return {
    inputs,
    filterComplex: filters.join(';\n'),
    outputArgs,
    totalDurationMs: snapshot.durationMs,
  }
}

/**
 * Build the full FFmpeg command-line arguments.
 */
export function buildFFmpegArgs(plan: RenderPlan, outputPath: string): string[] {
  const args: string[] = []

  for (const input of plan.inputs) {
    args.push('-i', input)
  }

  if (plan.filterComplex) {
    args.push('-filter_complex', plan.filterComplex)
  }

  args.push(...plan.outputArgs)
  args.push('-y', outputPath)

  return args
}
