import { test, expect } from '@playwright/test'
import {
  createTrack,
  insertClip,
  insertClipAt,
  splitClipAtPlayhead,
  removeClip,
  trimClipLeft,
  trimClipRight,
  addCrossDissolve,
  updateTransitionDuration,
  removeTransition,
  insertTrackAbove,
  computeSequenceDuration,
  hasOverlap,
} from '../src/lib/timeline/operations'
import type { TimelineTrack, TimelineClip, TimelineTransition } from '../src/types/timeline'

test.describe('Timeline operations', () => {
  test('createTrack returns a track with correct kind and sortOrder', () => {
    const track = createTrack('video', 'V1', 2)
    expect(track.kind).toBe('video')
    expect(track.label).toBe('V1')
    expect(track.sortOrder).toBe(2)
    expect(track.clips).toEqual([])
    expect(track.id).toBeTruthy()
  })

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

  test('removeClip removes the specified clip', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const { track: t2 } = insertClip(t1, 'http://b.mp4', 'video', 3000)
    expect(t2.clips).toHaveLength(2)

    const removed = removeClip(t2, t2.clips[0].id)
    expect(removed.clips).toHaveLength(1)
    expect(removed.clips[0].fileUrl).toBe('http://b.mp4')
  })

  test('trimClipLeft adjusts startMs and inPointMs', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 10000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipLeft(t1, clipId, 3000)
    expect(trimmed.clips[0].startMs).toBe(3000)
    expect(trimmed.clips[0].inPointMs).toBe(3000)
    expect(trimmed.clips[0].endMs).toBe(10000)
  })

  test('trimClipLeft clamps to minimum duration', () => {
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

  test('trimClipRight clamps to minimum duration', () => {
    const track = createTrack('video')
    const { track: t1 } = insertClip(track, 'http://a.mp4', 'video', 5000)
    const clipId = t1.clips[0].id

    const trimmed = trimClipRight(t1, clipId, 50)
    expect(trimmed.clips[0].endMs).toBeGreaterThan(trimmed.clips[0].startMs)
  })

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

    const updated = updateTransitionDuration(transitions, 't1', 1000)
    expect(updated[0].durationMs).toBe(1000)

    const tooSmall = updateTransitionDuration(transitions, 't1', 10)
    expect(tooSmall[0].durationMs).toBe(100)

    const tooLarge = updateTransitionDuration(transitions, 't1', 5000)
    expect(tooLarge[0].durationMs).toBe(2000)
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

  test('computeSequenceDuration returns max endMs across all tracks', () => {
    const track1 = createTrack('video')
    const { track: t1 } = insertClip(track1, 'http://a.mp4', 'video', 5000)
    const track2 = createTrack('video')
    const { track: t2 } = insertClip(track2, 'http://b.mp4', 'video', 8000)

    expect(computeSequenceDuration([t1, t2])).toBe(8000)
    expect(computeSequenceDuration([t1])).toBe(5000)
    expect(computeSequenceDuration([])).toBe(0)
  })

  test('hasOverlap detects overlapping clips', () => {
    const clips: TimelineClip[] = [
      { id: 'a', trackId: 't', outputId: null, fileUrl: '', fileType: 'video', startMs: 0, endMs: 5000, inPointMs: 0, outPointMs: 5000, sourceDurationMs: 5000, sortOrder: 0 },
      { id: 'b', trackId: 't', outputId: null, fileUrl: '', fileType: 'video', startMs: 4000, endMs: 8000, inPointMs: 0, outPointMs: 4000, sourceDurationMs: 4000, sortOrder: 1 },
    ]
    expect(hasOverlap(clips)).toBe(true)

    clips[1].startMs = 5000
    expect(hasOverlap(clips)).toBe(false)
  })
})
