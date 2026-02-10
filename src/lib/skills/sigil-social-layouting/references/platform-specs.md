# Platform specs (safe zones)

Version: 1.0.0. Dimensions and safe zones for Loop paid social assets.

## 4x5 (Feed)

- **Canvas**: 1440 × 1800 px
- **Safe zone**: No text or CTAs in **top 180px** or **bottom 180px**. Left/right margin 80px for main content.
- **Usable text area**: Central 1440×1440 (1:1). Images/backgrounds may extend into safe zones.
- **Main margin**: 80px

## 9x16 (Story)

- **Canvas**: 1440 × 2560 px
- **Safe zone**: No text or CTAs in **top 240px** or **bottom 492px**. Left/right 80px margin.
- **Usable text area**: 1440 × 1828 px (center).
- **Main margin**: 80px

## 1:1 (Square)

- **Canvas**: 1080 × 1080 px
- **Safe zone**: 80px margin on all sides. Usable 920×920.

## Normalized coordinates

All layout positions use **normalized 0–1** space:

- (0, 0) = top-left of canvas
- (1, 1) = bottom-right
- Convert to px: `xPx = xNorm * widthPx`, `yPx = yNorm * heightPx`

Example for 4x5: top safe zone ends at 180/1800 = 0.1, so any text block with `bbox.y < 0.1` or `bbox.y + bbox.height > 1 - 0.1` (bottom) violates.
