import { test, expect } from '@playwright/test'
import {
  createTrack,
  insertClip,
  insertClipAt,
  splitClipAtPlayhead,
  removeClip,
  moveClip,
  trimClipLeft,
  trimClipRight,
  addCrossDissolve,
  updateTransitionDuration,
  removeTransition,
  addCaption,
  removeCaption,
  insertTrackAbove,
  removeTrackAndCleanup,
  computeSequenceDuration,
  hasOverlap,
  snapToGrid,
  snapToNearby,
} from '../src/lib/timeline/operations'
import type { TimelineTrack, TimelineClip, TimelineTransition } from '../src/types/timeline'

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: `clip-${Math.random().toString(36).slice(2, 6)}`,
    trackId: 't',
    outputId: null,
    fileUrl: '',
    fileType: 'video',
    startMs: 0,
    endMs: 5000,
    inPointMs: 0,
    outPointMs: 5000,
    sourceDurationMs: 5000,
    sortOrder: 0,
    ...overrides,
  }
}

test.describe('Track operations', () => {
  test('createTrack returns a track with correct kind and sortOrder', () => {
    const track = createTrack('video', 'V1', 2)
    expect(track.kind).toBe('video')
    expect(track.label).toBe('V1')
    expect(track.sortOrder).toBe(2)
    expect(track.clips).toEqual([])
    expect(track.id).toBeTruthy()
  })

  test('createTrack uses default labels per kind', () => {
    expect(createTrack('video').label).toBe('Video')
    expect(createTrack('audio').label).toBe('Audio')
    expect(createTrack('caption').label).toBe('Captions')
  })
})

test.describe('Clip insertion', () => {
  test('insertClip appends at end of track', () => {
    const track = createTrack('video')
    const { track: t1, clip: c1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    expect(t1.clips).toHaveLength(1)
    expect(c1.startMs).toBe(0)
    expect(c1.endMs).toBe(5000)

    const { track: t2, clip: c2 } = insertClip(t1, 'http://b.mp4', 'video', 3000)
    expect(t2.clips).toHaveLength(2)
    expect(c2.startMs).toBeGreaterThanOrEqual(c1.endMs)
  })

  test('insertClipAt places clip at specified time', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClipAt(track, 'http://a.mp4', 'video', 3000, 2000, 'out1')
    expect(t1.clips).toHaveLength(1)
    expect(t1.clips[0].startMs).toBe(2000)
    expect(t1.clips[0].endMs).toBe(5000)
    expect(t1.clips[0].outputId).toBe('out1')
  })

  test('insertClipAt sets correct in/out points', () => {
    const track = createTrack('video')
    const { clip } = insertClipAt(track, 'http://a.mp4', 'video', 7000, 1000)
    expect(clip.inPointMs).toBe(0)
    expect(clip.outPointMs).toBe(7000)
    expect(clip.sourceDurationMs).toBe(7000)
  })
})

test.describe('Split', () => {
  test('splitClipAtPlayhead produces two clips with correct in/out points', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 10000)
    const clipId = t1.clips[0].id

    const split = splitClipAtPlayhead(t1, clipId, 4000)
    expect(split.clips).toHaveLength(2)

    const left = split.clips[0]
    const right = split.clips[1]
    expect(left.endMs).toBe(4000)
    expect(right.startMs).toBe(4000)
    expect(left.outPointMs).toBe(4000)
    expect(right.inPointMs).toBe(4000)
  })

  test('splitClipAtPlayhead ignores out-of-range playhead', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id

    expect(splitClipAtPlayhead(t1, clipId, 0).clips).toHaveLength(1)
    expect(splitClipAtPlayhead(t1, clipId, 5000).clips).toHaveLength(1)
    expect(splitClipAtPlayhead(t1, clipId, -100).clips).toHaveLength(1)
  })

  test('splitClipAtPlayhead ignores missing clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    expect(splitClipAtPlayhead(t1, 'nonexistent', 2000).clips).toHaveLength(1)
  })
})

test.describe('Remove clip', () => {
  test('removeClip removes the specified clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const { track: t2 } = insertClip(t1, 'http://b.mp4', 'video', 3000)
    expect(t2.clips).toHaveLength(2)

    const removed = removeClip(t2, t2.clips[0].id)
    expect(removed.clips).toHaveLength(1)
    expect(removed.clips[0].fileUrl).toBe('http://b.mp4')
  })

  test('removeClip is a no-op for missing IDs', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    expect(removeClip(t1, 'nonexistent').clips).toHaveLength(1)
  })
})

test.describe('Move clip', () => {
  test('moveClip updates startMs and endMs', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id

    const moved = moveClip(t1, clipId, 2000)
    expect(moved.clips[0].startMs).toBeGreaterThanOrEqual(0)
    expect(moved.clips[0].endMs - moved.clips[0].startMs).toBe(5000)
  })

  test('moveClip clamps to zero', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const moved = moveClip(t1, t1.clips[0].id, -1000)
    expect(moved.clips[0].startMs).toBe(0)
  })

  test('moveClip ignores missing clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const moved = moveClip(t1, 'nonexistent', 2000)
    expect(moved).toBe(t1)
  })
})

test.describe('Trim operations', () => {
  test('trimClipLeft adjusts startMs and inPointMs', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 10000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipLeft(t1, clipId, 3000)
    expect(trimmed.clips[0].startMs).toBe(3000)
    expect(trimmed.clips[0].inPointMs).toBe(3000)
    expect(trimmed.clips[0].endMs).toBe(10000)
  })

  test('trimClipLeft clamps to prevent zero-duration clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipLeft(t1, clipId, 5000)
    expect(trimmed.clips[0].startMs).toBeLessThan(trimmed.clips[0].endMs)
  })

  test('trimClipRight adjusts endMs and outPointMs', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 10000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipRight(t1, clipId, 6000)
    expect(trimmed.clips[0].endMs).toBe(6000)
    expect(trimmed.clips[0].outPointMs).toBe(6000)
  })

  test('trimClipRight clamps to prevent zero-duration clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipRight(t1, clipId, 50)
    expect(trimmed.clips[0].endMs).toBeGreaterThan(trimmed.clips[0].startMs)
  })

  test('trimClipRight respects sourceDurationMs ceiling', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id
    const trimmed = trimClipRight(t1, clipId, 20000)
    expect(trimmed.clips[0].outPointMs).toBeLessThanOrEqual(5000)
  })
})

test.describe('Transition operations', () => {
  test('addCrossDissolve creates a transition and prevents duplicates', () => {
    const transitions: TimelineTransition[] = []
    const t1 = addCrossDissolve(transitions, 'seq1', 'clipA', 'clipB', 500)
    expect(t1).toHaveLength(1)
    expect(t1[0].fromClipId).toBe('clipA')
    expect(t1[0].toClipId).toBe('clipB')
    expect(t1[0].durationMs).toBe(500)

    const t2 = addCrossDissolve(t1, 'seq1', 'clipA', 'clipB')
    expect(t2).toHaveLength(1)
  })

  test('updateTransitionDuration clamps to valid range', () => {
    const transitions: TimelineTransition[] = [{
      id: 't1', sequenceId: 's1', type: 'cross_dissolve',
      fromClipId: 'a', toClipId: 'b', durationMs: 500,
    }]

    expect(updateTransitionDuration(transitions, 't1', 1000)[0].durationMs).toBe(1000)
    expect(updateTransitionDuration(transitions, 't1', 10)[0].durationMs).toBe(100)
    expect(updateTransitionDuration(transitions, 't1', 5000)[0].durationMs).toBe(2000)
  })

  test('updateTransitionDuration is a no-op for missing ID', () => {
    const transitions: TimelineTransition[] = [{
      id: 't1', sequenceId: 's1', type: 'cross_dissolve',
      fromClipId: 'a', toClipId: 'b', durationMs: 500,
    }]
    const updated = updateTransitionDuration(transitions, 'nonexistent', 1000)
    expect(updated[0].durationMs).toBe(500)
  })

  test('removeTransition removes by ID', () => {
    const transitions: TimelineTransition[] = [
      { id: 't1', sequenceId: 's1', type: 'cross_dissolve', fromClipId: 'a', toClipId: 'b', durationMs: 500 },
      { id: 't2', sequenceId: 's1', type: 'cross_dissolve', fromClipId: 'b', toClipId: 'c', durationMs: 500 },
    ]
    const result = removeTransition(transitions, 't1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })
})

test.describe('Caption operations', () => {
  test('addCaption appends a caption to the track', () => {
    const track = createTrack('caption')
    const updated = addCaption(track, 'Hello world', 1000, 4000)
    expect(updated.captions).toHaveLength(1)
    expect(updated.captions![0].text).toBe('Hello world')
    expect(updated.captions![0].startMs).toBe(1000)
    expect(updated.captions![0].endMs).toBe(4000)
    expect(updated.captions![0].style.color).toBe('#FFFFFF')
  })

  test('addCaption allows custom style overrides', () => {
    const track = createTrack('caption')
    const updated = addCaption(track, 'Red text', 0, 2000, { color: '#FF0000', position: 'top' })
    expect(updated.captions![0].style.color).toBe('#FF0000')
    expect(updated.captions![0].style.position).toBe('top')
    expect(updated.captions![0].style.fontSize).toBe(24)
  })

  test('removeCaption removes by ID', () => {
    const track = createTrack('caption')
    const t1 = addCaption(track, 'First', 0, 2000)
    const t2 = addCaption(t1, 'Second', 3000, 5000)
    expect(t2.captions).toHaveLength(2)

    const capId = t2.captions![0].id
    const removed = removeCaption(t2, capId)
    expect(removed.captions).toHaveLength(1)
    expect(removed.captions![0].text).toBe('Second')
  })

  test('removeCaption is a no-op for missing IDs', () => {
    const track = createTrack('caption')
    const t1 = addCaption(track, 'Keep me', 0, 2000)
    const result = removeCaption(t1, 'nonexistent')
    expect(result.captions).toHaveLength(1)
  })
})

test.describe('Track stacking', () => {
  test('insertTrackAbove inserts before reference track and reorders', () => {
    const tracks: TimelineTrack[] = [
      { ...createTrack('video', 'V1', 0), sequenceId: 's1' },
      { ...createTrack('audio', 'A1', 1), sequenceId: 's1' },
    ]
    const refId = tracks[1].id
    const { tracks: result, newTrack } = insertTrackAbove(tracks, refId, 'video', 'V2')

    expect(result).toHaveLength(3)
    expect(result[1].id).toBe(refId)
    expect(newTrack.kind).toBe('video')
    expect(newTrack.label).toBe('V2')

    for (let i = 0; i < result.length; i++) {
      expect(result[i].sortOrder).toBe(i)
    }
  })

  test('insertTrackAbove falls back to index 0 for missing reference', () => {
    const tracks: TimelineTrack[] = [
      { ...createTrack('video', 'V1', 0), sequenceId: 's1' },
    ]
    const { tracks: result } = insertTrackAbove(tracks, 'nonexistent', 'audio')
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('audio')
  })
})

test.describe('Duration and overlap', () => {
  test('computeSequenceDuration returns max endMs across all tracks', () => {
    const track1 = createTrack('video')
    const { track: t1 } = insertClip(track1, 'http://a.mp4', 'video', 5000)
    const track2 = createTrack('video')
    const { track: t2 } = insertClip(track2, 'http://b.mp4', 'video', 8000)

    expect(computeSequenceDuration([t1, t2])).toBe(8000)
    expect(computeSequenceDuration([t1])).toBe(5000)
    expect(computeSequenceDuration([])).toBe(0)
  })

  test('computeSequenceDuration includes captions', () => {
    const track = addCaption(createTrack('caption'), 'Test', 0, 12000)
    expect(computeSequenceDuration([track])).toBe(12000)
  })

  test('hasOverlap detects overlapping clips', () => {
    const overlapping: TimelineClip[] = [
      makeClip({ id: 'a', startMs: 0, endMs: 5000 }),
      makeClip({ id: 'b', startMs: 4000, endMs: 8000 }),
    ]
    expect(hasOverlap(overlapping)).toBe(true)

    const adjacent: TimelineClip[] = [
      makeClip({ id: 'a', startMs: 0, endMs: 5000 }),
      makeClip({ id: 'b', startMs: 5000, endMs: 8000 }),
    ]
    expect(hasOverlap(adjacent)).toBe(false)
  })

  test('hasOverlap excludes a specific clip', () => {
    const clips: TimelineClip[] = [
      makeClip({ id: 'a', startMs: 0, endMs: 5000 }),
      makeClip({ id: 'b', startMs: 4000, endMs: 8000 }),
    ]
    expect(hasOverlap(clips, 'b')).toBe(false)
  })
})

test.describe('Snap utilities', () => {
  test('snapToGrid rounds to nearest grid unit', () => {
    expect(snapToGrid(150, 100)).toBe(200)
    expect(snapToGrid(149, 100)).toBe(100)
    expect(snapToGrid(0, 100)).toBe(0)
  })

  test('snapToNearby finds nearest clip edge', () => {
    const clips: TimelineClip[] = [
      makeClip({ startMs: 1000, endMs: 3000 }),
      makeClip({ startMs: 5000, endMs: 8000 }),
    ]
    const snapped = snapToNearby(2950, clips, 20, 10)
    expect(snapped).toBe(3000)
  })
})

test.describe('Track removal and cleanup', () => {
  test('removeTrackAndCleanup removes the track and re-normalizes sortOrder', () => {
    const t0 = { ...createTrack('video', 'V1', 0), sequenceId: 's1' }
    const t1 = { ...createTrack('audio', 'A1', 1), sequenceId: 's1' }
    const t2 = { ...createTrack('video', 'V2', 2), sequenceId: 's1' }

    const { tracks } = removeTrackAndCleanup([t0, t1, t2], t1.id, [])
    expect(tracks).toHaveLength(2)
    expect(tracks.find((t) => t.id === t1.id)).toBeUndefined()
    expect(tracks[0].sortOrder).toBe(0)
    expect(tracks[1].sortOrder).toBe(1)
  })

  test('removeTrackAndCleanup prunes transitions referencing removed clips', () => {
    const track = createTrack('video', 'V1', 0)
    track.sequenceId = 's1'
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const { track: t2, clip: clipB } = insertClip(t1, 'http://b.mp4', 'video', 3000)

    const otherTrack = createTrack('video', 'V2', 1)
    otherTrack.sequenceId = 's1'
    const { track: ot1, clip: clipC } = insertClip(otherTrack, 'http://c.mp4', 'video', 4000)
    const { track: ot2, clip: clipD } = insertClip(ot1, 'http://d.mp4', 'video', 2000)

    const transitions: TimelineTransition[] = [
      { id: 'tx1', sequenceId: 's1', type: 'cross_dissolve', fromClipId: t2.clips[0].id, toClipId: clipB.id, durationMs: 500 },
      { id: 'tx2', sequenceId: 's1', type: 'cross_dissolve', fromClipId: clipC.id, toClipId: clipD.id, durationMs: 500 },
    ]

    const result = removeTrackAndCleanup([t2, ot2], t2.id, transitions)
    expect(result.tracks).toHaveLength(1)
    expect(result.transitions).toHaveLength(1)
    expect(result.transitions[0].id).toBe('tx2')
  })

  test('removeTrackAndCleanup is a no-op for missing track IDs', () => {
    const track = createTrack('video', 'V1', 0)
    track.sequenceId = 's1'
    const result = removeTrackAndCleanup([track], 'nonexistent', [])
    expect(result.tracks).toHaveLength(1)
  })

  test('removeTrackAndCleanup updates duration correctly', () => {
    const t0 = createTrack('video', 'V1', 0)
    t0.sequenceId = 's1'
    const { track: withClip } = insertClip(t0, 'http://a.mp4', 'video', 10000)
    const t1 = createTrack('video', 'V2', 1)
    t1.sequenceId = 's1'
    const { track: shortTrack } = insertClip(t1, 'http://b.mp4', 'video', 3000)

    const { tracks } = removeTrackAndCleanup([withClip, shortTrack], withClip.id, [])
    expect(computeSequenceDuration(tracks)).toBe(3000)
  })
})

test.describe('Mixed-media insert', () => {
  test('insertClip accepts image fileType with 5s default', () => {
    const track = createTrack('video', 'V1', 0)
    const { track: updated, clip } = insertClip(track, 'http://img.png', 'image', 5000, 'out-1')
    expect(clip.fileType).toBe('image')
    expect(clip.sourceDurationMs).toBe(5000)
    expect(clip.endMs - clip.startMs).toBe(5000)
    expect(updated.clips).toHaveLength(1)
  })

  test('mixed video and image clips compute correct duration', () => {
    const track = createTrack('video', 'V1', 0)
    const { track: t1 } = insertClip(track, 'http://v.mp4', 'video', 8000, 'out-v')
    const { track: t2 } = insertClip(t1, 'http://img.png', 'image', 5000, 'out-i')
    expect(computeSequenceDuration([t2])).toBe(13000)
    expect(t2.clips[0].fileType).toBe('video')
    expect(t2.clips[1].fileType).toBe('image')
  })
})
