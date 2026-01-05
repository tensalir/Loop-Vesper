# Quick Summary: Generation Progress Interval Cost

## The Problem
Each in-progress generation runs a 100ms interval and updates React state. Multiple active generations can cause unnecessary CPU usage and frequent rerenders.

## Impact
- Higher CPU usage during active generations
- UI jitter on slower devices

## Quick Fix
- Reduce update frequency to 500-1000ms or use CSS animations.
- Optionally use a shared timer for all progress components.

## Key File
- `components/generation/GenerationProgress.tsx`
