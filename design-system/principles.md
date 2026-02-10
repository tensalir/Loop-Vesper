# Loop-Vesper Design Principles

> A comprehensive guide to the visual language, interaction patterns, and design philosophy behind Loop-Vesper.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Visual Identity](#visual-identity)
3. [Color System](#color-system)
4. [Typography](#typography)
5. [Spacing & Layout](#spacing--layout)
6. [Motion & Animation](#motion--animation)
7. [Shadows & Elevation](#shadows--elevation)
8. [Components](#components)
9. [Accessibility](#accessibility)
10. [Dark Mode](#dark-mode)
11. [Responsive Design](#responsive-design)
12. [Implementation Notes](#implementation-notes)

---

## Philosophy

### Core Values

Loop-Vesper's design system is built on three foundational principles:

1. **Warmth with Sophistication**  
   We reject cold, clinical interfaces in favor of warm, inviting spaces that still feel professional and modern. Our light mode uses cream tones instead of stark whites; our dark mode uses deep charcoals instead of pure blacks.

2. **Quiet Confidence**  
   The interface should support—not compete with—the user's creative work. We favor subtle interactions, soft shadows, and restrained animations that communicate state without demanding attention.

3. **Intentional Minimalism**  
   Every element earns its place. We remove visual noise ruthlessly, but never at the cost of clarity or usability. Negative space is a feature, not an afterthought.

### Design DNA

Loop-Vesper inherits aesthetic sensibilities from:

- **Swiss Design**: Clean typography, grid-based layouts, functional beauty
- **Japanese Minimalism**: Intentional emptiness (ma), subtle craftsmanship
- **Modern SaaS**: Familiar patterns, intuitive interactions, professional polish

---

## Visual Identity

### Brand Personality

| Attribute       | Expression                                    |
|-----------------|-----------------------------------------------|
| **Modern**      | Clean lines, contemporary typefaces, flat design with subtle depth |
| **Creative**    | Accent colors that inspire, space for expression |
| **Professional**| Restrained animations, consistent patterns, accessibility-first |
| **Approachable**| Warm palette, generous spacing, clear hierarchy |

### Logo Usage

The Loop-Vesper logo exists in three variants:

- **Black**: For light backgrounds
- **White**: For dark backgrounds  
- **Mint**: For special emphasis (use sparingly)

Minimum clear space: 1x the height of the Loop prism mark.

---

## Color System

### Philosophy

Our color system uses HSL (Hue, Saturation, Lightness) values stored as channel-only CSS custom properties. This enables:

- Flexible alpha manipulation: `hsl(var(--primary) / 0.5)`
- Easy theming via CSS variable overrides
- Semantic naming that abstracts implementation

### Light Mode Palette

Light mode evokes **warmth and clarity**—a sunlit creative studio.

| Token             | HSL Value        | Hex       | Usage                          |
|-------------------|------------------|-----------|--------------------------------|
| `--background`    | 35 20% 97%       | #FAF8F5   | Main app background (warm cream) |
| `--foreground`    | 0 0% 10%         | #1A1A1A   | Primary text (deep charcoal)   |
| `--card`          | 0 0% 100%        | #FFFFFF   | Card surfaces (pure white)     |
| `--primary`       | 263 66% 44%      | #6B26B8   | Brand accent (purple)          |
| `--secondary`     | 35 25% 92%       | #F2EDE6   | Secondary surfaces (warm gray) |
| `--muted`         | 35 15% 90%       | #EBE7E2   | Subtle backgrounds             |
| `--border`        | 35 10% 88%       | #E5E2DD   | Soft borders                   |
| `--destructive`   | 0 72% 51%        | #DC2626   | Errors, dangerous actions      |

### Dark Mode Palette

Dark mode evokes **focus and depth**—a midnight creative session.

| Token             | HSL Value        | Hex       | Usage                          |
|-------------------|------------------|-----------|--------------------------------|
| `--background`    | 0 0% 8%          | #141414   | Main background (deep dark)    |
| `--foreground`    | 0 0% 98%         | #FAFAFA   | Primary text (near white)      |
| `--card`          | 0 0% 12%         | #1F1F1F   | Elevated surfaces              |
| `--primary`       | 131 100% 85%     | #B3FFD1   | Brand accent (mint green)      |
| `--secondary`     | 0 0% 16%         | #292929   | Secondary surfaces             |
| `--muted`         | 0 0% 18%         | #2E2E2E   | Subtle backgrounds             |
| `--border`        | 0 0% 20%         | #333333   | Subtle borders                 |
| `--destructive`   | 0 72% 55%        | #E53E3E   | Errors (brighter for visibility) |

### Color Usage Guidelines

1. **Never use raw hex values**—always reference semantic tokens
2. **Maintain 4.5:1 contrast ratio** for text on backgrounds (WCAG AA)
3. **Use alpha variants** for hover states and overlays: `hsl(var(--primary) / 0.1)`
4. **Primary color** is reserved for CTAs, active states, and brand moments
5. **Destructive color** should be used sparingly and only for irreversible actions

---

## Typography

### Type Scale

We use **Space Grotesk** as our primary typeface—a geometric sans-serif that balances personality with readability.

| Element        | Weight    | Usage                                |
|----------------|-----------|--------------------------------------|
| Display        | 700 Bold  | Hero headlines, marketing (Avantt)   |
| Heading 1      | 600       | Page titles                          |
| Heading 2      | 600       | Section headers                      |
| Heading 3      | 500       | Subsection headers                   |
| Body           | 400       | Paragraphs, descriptions             |
| Caption        | 400       | Helper text, metadata                |

### Font Stack

```css
--font-sans: 'Space Grotesk', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-display: 'Avantt', var(--font-sans);
```

### Typography Principles

1. **Hierarchy is king**: Use weight and size—not color—to establish hierarchy
2. **Line length matters**: Optimal reading width is 60-75 characters
3. **Generous line height**: Body text uses 1.5 line height for comfortable reading
4. **Consistent rhythm**: Use the spacing scale for margins between text blocks

---

## Spacing & Layout

### Spacing Scale

All spacing derives from a 4px base unit:

| Token      | Value     | Pixels  | Usage                              |
|------------|-----------|---------|-------------------------------------|
| `space-1`  | 0.25rem   | 4px     | Tight gaps, icon margins           |
| `space-2`  | 0.5rem    | 8px     | Inline element spacing             |
| `space-3`  | 0.75rem   | 12px    | Small component padding            |
| `space-4`  | 1rem      | 16px    | Standard component padding         |
| `space-6`  | 1.5rem    | 24px    | Section padding                    |
| `space-8`  | 2rem      | 32px    | Large gaps                         |
| `space-12` | 3rem      | 48px    | Major section breaks               |
| `space-16` | 4rem      | 64px    | Page-level spacing                 |

### Layout Principles

1. **Consistent gutters**: Use `--dock-gap` (1rem/16px) between adjacent elements
2. **Responsive scaling**: Layout tokens adjust at breakpoints (see `tokens.css`)
3. **Content-first widths**: Max-widths prevent text from becoming too wide to read
4. **Breathing room**: Prefer generous padding over cramped interfaces

### Grid System

- Container max-width: 1400px (centered)
- Container padding: 2rem
- Soft grid pattern: 40px cells for visual alignment guides

---

## Motion & Animation

### Timing Tokens

| Token              | Value    | Usage                                |
|--------------------|----------|--------------------------------------|
| `--duration-fast`  | 100ms    | Micro-interactions (hover states)    |
| `--duration-normal`| 200ms    | Standard transitions                 |
| `--duration-slow`  | 400ms    | Emphasis animations                  |
| `--duration-slower`| 1000ms+  | Loading states, dramatic reveals     |

### Animation Principles

1. **Default to 200ms**: This is the sweet spot for most UI transitions
2. **Use ease-out for entrances**: Elements arriving should decelerate
3. **Use ease-in for exits**: Elements leaving should accelerate away
4. **Color transitions everywhere**: All elements inherit `transition-colors duration-200`
5. **Purposeful motion only**: Animation should communicate state, not decorate

### Signature Animations

**Enhancing Container**: A pulsing glow effect used during AI processing states. Features:
- Border glow with primary accent color
- Shimmer sweep across the border
- Scanning line that moves vertically
- Duration: 1.5-2s cycles

**Stack Pulse**: A breathing opacity animation for stacked/queued elements:
- Cycles between 100% and 50% opacity
- Duration: 2s ease-in-out infinite

---

## Shadows & Elevation

### Shadow Scale

Our shadows are intentionally soft and subtle—they suggest depth without creating harsh edges.

| Class        | Shadow Definition                                              | Usage                    |
|--------------|----------------------------------------------------------------|--------------------------|
| `shadow-sm`  | `0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)`      | Subtle lift (buttons)    |
| `shadow`     | `0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)`      | Cards, default elevation |
| `shadow-lg`  | `0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)`    | Modals, overlays         |

### Elevation Principles

1. **Low-opacity shadows**: Maximum opacity is 8%—never harsh black shadows
2. **Multi-layer shadows**: Each shadow uses two layers for realistic softness
3. **Consistent in both modes**: Shadow values work in light and dark mode
4. **Z-index follows elevation**: Higher shadows = higher z-index

---

## Components

### Border Radius

| Token        | Value                      | Usage                          |
|--------------|----------------------------|--------------------------------|
| `radius-sm`  | calc(0.75rem - 4px) ≈ 8px  | Small elements, badges         |
| `radius-md`  | calc(0.75rem - 2px) ≈ 10px | Buttons, inputs                |
| `radius-lg`  | 0.75rem = 12px             | Cards, containers              |
| `radius-full`| 9999px                     | Pills, avatars, toggles        |

### Component Guidelines

**Cards**
- Use `--card` background with `--card-foreground` text
- Apply `shadow` for default elevation
- Use `radius-lg` (12px) for corners
- Padding: `space-4` (16px) minimum

**Buttons**
- Primary: `--primary` background, `--primary-foreground` text
- Secondary: `--secondary` background, `--secondary-foreground` text
- Ghost: Transparent background, `--foreground` text
- All buttons: `radius-md` corners, 200ms transitions

**Inputs**
- Border: `--input` color, transitions to `--ring` on focus
- Background: Transparent or `--background`
- Focus ring: 2px solid `--ring` with offset

**Popovers & Dropdowns**
- Background: `--popover`
- Border: `--border`
- Shadow: `shadow-lg`
- Z-index: `--z-popover` (300)

---

## Accessibility

### Requirements

Loop-Vesper targets **WCAG 2.1 AA compliance**:

- **Color contrast**: 4.5:1 for normal text, 3:1 for large text
- **Keyboard navigation**: All interactive elements are focusable
- **Focus indicators**: Visible focus rings using `--ring` color
- **Screen reader support**: Semantic HTML, ARIA labels where needed
- **Reduced motion**: Respect `prefers-reduced-motion` media query

### Focus States

All focusable elements display:
- 2px solid ring using `--ring` color
- Offset for visibility against backgrounds
- Consistent appearance across all components

### Color Independence

Never rely on color alone to convey meaning:
- Error states include icons and text, not just red color
- Interactive elements have hover/focus states beyond color change
- Status indicators use icons alongside colored badges

---

## Dark Mode

### Implementation

Dark mode is activated via the `.dark` class on a parent element (typically `<html>` or `<body>`).

```html
<html class="dark">
  <!-- Dark mode active -->
</html>
```

### Design Considerations

1. **Don't just invert**: Dark mode has its own curated palette, not a simple inversion
2. **Reduce contrast slightly**: Pure white (#FFF) on pure black (#000) causes eye strain
3. **Shift accent colors**: Light mode purple → dark mode mint green for optimal visibility
4. **Adjust shadow opacity**: Shadows are less visible in dark mode; consider glow effects instead
5. **Test images**: Ensure product images and illustrations work in both modes

### Mode Switching

- Respect system preference via `prefers-color-scheme` media query
- Provide manual toggle for user override
- Persist preference in localStorage

---

## Responsive Design

### Breakpoints

| Name   | Width    | Typical Devices                  |
|--------|----------|----------------------------------|
| `sm`   | 640px    | Large phones, small tablets      |
| `md`   | 768px    | Tablets                          |
| `lg`   | 1024px   | Small laptops, landscape tablets |
| `xl`   | 1280px   | Laptops, desktops                |
| `2xl`  | 1536px   | Large desktops                   |
| `3xl`  | 1800px   | Ultra-wide monitors              |

### Responsive Principles

1. **Mobile-first CSS**: Start with mobile styles, layer on complexity
2. **Content determines breakpoints**: Don't design to devices—design to content needs
3. **Fluid where possible**: Use relative units (rem, %) over fixed pixels
4. **Touch targets**: Minimum 44x44px on touch devices
5. **Progressive enhancement**: Core functionality works everywhere; enhanced on capable devices

### Mobile Adaptations

- Sidebars transform to bottom sheets
- Complex modals become full-screen on small devices
- Gallery layouts switch to single column
- Node-based interfaces disabled (too complex for touch)

---

## Implementation Notes

### CSS Custom Properties

All tokens are defined as CSS custom properties in `:root` and `.dark`:

```css
:root {
  --primary: 263 66% 44%;
}

.dark {
  --primary: 131 100% 85%;
}
```

Usage with alpha:
```css
.element {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}
```

### Tailwind Integration

Tailwind config maps semantic classes to CSS variables:

```js
colors: {
  primary: {
    DEFAULT: "hsl(var(--primary))",
    foreground: "hsl(var(--primary-foreground))",
  },
}
```

Usage:
```jsx
<button className="bg-primary text-primary-foreground">
  Click me
</button>
```

### shadcn/ui Compatibility

This design system is built on shadcn/ui conventions:
- Same CSS variable naming scheme
- Same color token structure (background, foreground, primary, etc.)
- Same Tailwind class patterns

To adopt in another shadcn/ui project:
1. Copy `tokens.css` content into your `globals.css`
2. Ensure Tailwind config maps colors to `hsl(var(--token))`
3. Adjust component styles as needed

---

## Legacy Notes

Some documentation (PRD.md, SUMMARY.md) references older values:
- Inter font → now Space Grotesk
- Cyan accent → now mint green (dark) / purple (light)
- Different shadow intensities

**This principles document and `tokens.css` represent the current source of truth.**

---

## Version History

| Version | Date       | Changes                                    |
|---------|------------|-------------------------------------------|
| 1.0.0   | 2026-02-03 | Initial extraction from Loop-Vesper       |

---

*This document is maintained alongside the Loop-Vesper codebase. For questions or contributions, see the main repository.*
