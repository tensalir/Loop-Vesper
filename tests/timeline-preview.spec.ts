import { test, expect } from '@playwright/test'
import { resolvePreviewClip } from '../src/lib/timeline/preview'
import { createTrack, insertClip, insertClipAt } from '../src/lib/timeline/operations'
import type { TimelineTrack } from '../src/types/timeline'

function buildTracks(...builders: Array<(t: TimelineTrack) => TimelineTrack>): TimelineTrack[] {
  return builders.map((fn, i) => {
    const track = createTrack('video', `V${i + 1}`, i)
    track.sequenceId = 'seq'
    return fn(track)
  })
}

test.describe('resolvePreviewClip — basic selection', () => {
  test('returns the clip that covers the playhead', () => {
    const tracks = buildTracks(
      (t) => insertClip(t, 'http://a.mp4', 'video', 5000).track,
    )
    const clip = resolvePreviewClip(tracks, 2500)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://a.mp4')
  })

  test('returns null for empty tracks', () => {
    expect(resolvePreviewClip([], 0)).toBeNull()
  })

  test('returns first clip when playhead is before all clips', () => {
    const tracks = buildTracks(
      (t) => insertClipAt(t, 'http://a.mp4', 'video', 3000, 2000).track,
    )
    const clip = resolvePreviewClip(tracks, 500)
    expect(clip).not.toBeNull()
    expect(clip!.startMs).toBe(2000)
  })

  test('returns last clip when playhead is past all clips', () => {
    const tracks = buildTracks(
      (t) => {
        const { track: t1 } = insertClip(t, 'http://a.mp4', 'video', 3000)
        return insertClip(t1, 'http://b.mp4', 'video', 2000).track
      },
    )
    const clip = resolvePreviewClip(tracks, 99999)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://b.mp4')
  })
})

test.describe('resolvePreviewClip — track stacking precedence', () => {
  test('top track clip wins when overlapping with lower track', () => {
    // Lower track: 0-5000ms
    const lower = createTrack('video', 'Bottom', 0)
    lower.sequenceId = 'seq'
    const { track: lowerTrack } = insertClip(lower, 'http://bottom.mp4', 'video', 5000)

    // Upper track: clip starts at 3000ms (overlapping the tail of the lower)
    const upper = createTrack('video', 'Top', 1)
    upper.sequenceId = 'seq'
    const { track: upperTrack } = insertClipAt(upper, 'http://top.mp4', 'video', 4000, 3000)

    const tracks = [lowerTrack, upperTrack]

    // At 2000ms — only the bottom track covers this, so bottom wins
    const clipBefore = resolvePreviewClip(tracks, 2000)
    expect(clipBefore).not.toBeNull()
    expect(clipBefore!.fileUrl).toBe('http://bottom.mp4')

    // At 3500ms — both tracks cover this, top track should win
    const clipDuring = resolvePreviewClip(tracks, 3500)
    expect(clipDuring).not.toBeNull()
    expect(clipDuring!.fileUrl).toBe('http://top.mp4')

    // At 6500ms — only the top track covers this
    const clipAfter = resolvePreviewClip(tracks, 6500)
    expect(clipAfter).not.toBeNull()
    expect(clipAfter!.fileUrl).toBe('http://top.mp4')
  })

  test('works regardless of array insertion order', () => {
    // Even if the top track is first in the array, sortOrder determines priority
    const top = createTrack('video', 'Top', 5)
    top.sequenceId = 'seq'
    const { track: topTrack } = insertClipAt(top, 'http://top.mp4', 'video', 3000, 1000)

    const bottom = createTrack('video', 'Bottom', 0)
    bottom.sequenceId = 'seq'
    const { track: bottomTrack } = insertClip(bottom, 'http://bottom.mp4', 'video', 5000)

    // Array order: top first, bottom second — sortOrder should still resolve correctly
    const tracks = [topTrack, bottomTrack]
    const clip = resolvePreviewClip(tracks, 2000)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://top.mp4')
  })
})

test.describe('resolvePreviewClip — micro-gap bridging', () => {
  test('bridges a small gap within the same track', () => {
    const track = createTrack('video', 'V1', 0)
    track.sequenceId = 'seq'
    const { track: t1 } = insertClipAt(track, 'http://a.mp4', 'video', 3000, 0)
    // 30ms gap, then second clip
    const { track: t2 } = insertClipAt(t1, 'http://b.mp4', 'video', 3000, 3030)

    const clip = resolvePreviewClip([t2], 3010)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://b.mp4')
  })

  test('does not bridge a large gap', () => {
    const track = createTrack('video', 'V1', 0)
    track.sequenceId = 'seq'
    const { track: t1 } = insertClipAt(track, 'http://a.mp4', 'video', 3000, 0)
    const { track: t2 } = insertClipAt(t1, 'http://b.mp4', 'video', 3000, 4000)

    const clip = resolvePreviewClip([t2], 3500)
    expect(clip).toBeNull()
  })

  test('bridge from higher track takes precedence over lower bridge', () => {
    // Two tracks each with a micro-gap at the same spot
    const lower = createTrack('video', 'Bottom', 0)
    lower.sequenceId = 'seq'
    const { track: l1 } = insertClipAt(lower, 'http://botA.mp4', 'video', 3000, 0)
    const { track: l2 } = insertClipAt(l1, 'http://botB.mp4', 'video', 3000, 3020)

    const upper = createTrack('video', 'Top', 1)
    upper.sequenceId = 'seq'
    const { track: u1 } = insertClipAt(upper, 'http://topA.mp4', 'video', 3000, 0)
    const { track: u2 } = insertClipAt(u1, 'http://topB.mp4', 'video', 3000, 3020)

    const clip = resolvePreviewClip([l2, u2], 3005)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://topB.mp4')
  })
})

test.describe('resolvePreviewClip — ignores non-video and muted tracks', () => {
  test('skips audio and caption tracks', () => {
    const audio = createTrack('audio', 'A1', 0)
    audio.sequenceId = 'seq'
    const caption = createTrack('caption', 'C1', 1)
    caption.sequenceId = 'seq'

    const video = createTrack('video', 'V1', 2)
    video.sequenceId = 'seq'
    const { track: vTrack } = insertClip(video, 'http://v.mp4', 'video', 5000)

    const clip = resolvePreviewClip([audio, caption, vTrack], 1000)
    expect(clip).not.toBeNull()
    expect(clip!.fileUrl).toBe('http://v.mp4')
  })
})
