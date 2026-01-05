# Quick Summary: Generation Gallery Virtualization

## The Problem
The generation feed renders every item in the DOM. Large sessions will cause heavy layout work, slow scrolling, and input lag.

## Impact
- Janky scrolling and high CPU usage on long sessions
- Poor perceived responsiveness

## Quick Fix
- Window the list with a virtualizer (react-virtual or react-window).
- Render only visible items plus a small overscan.

## Key Files
- `components/generation/GenerationGallery.tsx`
- `components/generation/GenerationInterface.tsx`
