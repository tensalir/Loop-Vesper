# LayoutSpec JSON schema

```json
{
  "version": "1.0.0",
  "formatId": "4x5",
  "widthPx": 1440,
  "heightPx": 1800,
  "textBlocks": [
    {
      "id": "headline-1",
      "role": "headline",
      "content": "Your headline",
      "bbox": { "x": 0.1, "y": 0.15, "width": 0.8, "height": 0.12 },
      "fontFamily": "Avantt",
      "fontWeight": 700,
      "scale": 1.2,
      "color": "#1A1A1A",
      "maxWidth": 0.9,
      "textAlign": "left"
    },
    {
      "id": "cta-1",
      "role": "cta",
      "content": "Shop Now",
      "bbox": { "x": 0.1, "y": 0.75, "width": 0.35, "height": 0.08 },
      "fontFamily": "Space Grotesk",
      "fontWeight": 600,
      "scale": 1,
      "color": "#FFFFFF",
      "textAlign": "center"
    }
  ],
  "safeZone": { "topPx": 180, "bottomPx": 180, "leftPx": 80, "rightPx": 80 },
  "rationale": "Headline in upper safe area; CTA in lower third, clear of focal point.",
  "confidence": 0.85,
  "createdAt": "2026-02-10T12:00:00.000Z"
}
```

**Roles**: headline | subhead | body | cta | legal | product-name  
**bbox**: x, y, width, height in 0–1.  
**scale**: Relative to base (1 = body size).  
**color**: Hex or token name.
