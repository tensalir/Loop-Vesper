# Generation Gallery Virtualization

## Problem Summary
The generations list renders all items at once, including images and video components. As sessions grow, this becomes a major UI performance bottleneck.

## Evidence
- `components/generation/GenerationGallery.tsx` renders `generations.map(...)` without virtualization.
- `components/generation/GenerationInterface.tsx` flattens all pages and passes the full array.

## Impact
- Large DOM trees and layout cost
- Slow scrolling and input lag
- Increased memory usage on the client

## Proposed Fix
1. Add list virtualization with `@tanstack/react-virtual` or `react-window`.
2. Keep the prompt column height stable (fixed or measured) to simplify windowing.
3. Only mount media components when rows are visible.

## Acceptance Criteria
- Scrolling remains smooth with 500+ generations.
- Only visible items are rendered in the DOM.

## Related Files
- `components/generation/GenerationGallery.tsx`
- `components/generation/GenerationInterface.tsx`
