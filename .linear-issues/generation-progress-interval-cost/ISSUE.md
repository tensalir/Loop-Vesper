# Generation Progress Interval Cost

## Problem Summary
`GenerationProgress` updates progress every 100ms with `setInterval`, which is expensive when multiple generations are processing.

## Evidence
- `components/generation/GenerationProgress.tsx` runs a 100ms interval and updates state per component.

## Impact
- CPU spikes during heavy generation activity
- Rerender storms for multiple concurrent generations

## Proposed Fix
1. Increase interval to 500-1000ms.
2. Consider CSS animations for smooth progress without JS updates.
3. Optionally share a single timer via context to reduce timers.

## Acceptance Criteria
- CPU usage is reduced during active generations.
- Progress UI remains smooth and responsive.

## Related File
- `components/generation/GenerationProgress.tsx`
