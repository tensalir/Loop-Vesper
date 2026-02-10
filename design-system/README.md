# Loop-Vesper Design System

A shareable design token bundle for maintaining visual consistency across Loop-Vesper and related projects.

## Contents

| File               | Format     | Purpose                                                |
|--------------------|------------|--------------------------------------------------------|
| `tokens.css`       | CSS        | CSS custom properties for direct import                |
| `tokens.json`      | JSON       | Platform-agnostic tokens (W3C-style) for tooling       |
| `principles.md`    | Markdown   | Comprehensive design philosophy and guidelines         |
| `README.md`        | Markdown   | This file - usage and sync documentation               |

---

## Quick Start

### Option 1: CSS Import (Recommended)

Copy `tokens.css` into your project and import it in your global styles:

```css
/* In your globals.css or app.css */
@import './path/to/tokens.css';

/* Then use the tokens */
body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.my-button {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-radius: var(--radius);
}
```

### Option 2: Copy Variables Only

If you prefer to integrate tokens into an existing CSS file, copy the `:root` and `.dark` blocks from `tokens.css`.

### Option 3: Tailwind Integration

For Tailwind CSS projects, configure your `tailwind.config.ts` to reference the CSS variables:

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
}

export default config
```

### Option 4: Using tokens.json

For design tools, build systems, or non-CSS platforms, parse `tokens.json`:

```javascript
// Node.js example
import tokens from './design-system/tokens.json';

// Access color values
const primaryLight = tokens.color.light.primary.hex; // "#6B26B8"
const primaryDark = tokens.color.dark.primary.hex;   // "#B3FFD1"

// Access other tokens
const baseRadius = tokens.radius.base.$value;        // "0.75rem"
const normalDuration = tokens.motion.duration.normal.$value; // "200ms"
```

---

## Dark Mode

The design system supports both light and dark modes.

### CSS Class Toggle

Dark mode is activated by adding the `.dark` class to a parent element:

```html
<!-- Light mode (default) -->
<html>
  <body>...</body>
</html>

<!-- Dark mode -->
<html class="dark">
  <body>...</body>
</html>
```

### JavaScript Toggle

```javascript
// Toggle dark mode
document.documentElement.classList.toggle('dark');

// Set based on system preference
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}
```

---

## Using Alpha/Opacity

The HSL values are stored as channel-only values (without the `hsl()` wrapper), enabling easy alpha manipulation:

```css
/* Solid color */
.solid {
  background: hsl(var(--primary));
}

/* 50% opacity */
.transparent {
  background: hsl(var(--primary) / 0.5);
}

/* 10% opacity for subtle backgrounds */
.subtle {
  background: hsl(var(--primary) / 0.1);
}
```

---

## shadcn/ui Compatibility

This design system follows [shadcn/ui](https://ui.shadcn.com/) conventions, making integration seamless:

1. **Same variable names**: `--background`, `--primary`, `--muted`, etc.
2. **Same HSL format**: Channel values for alpha manipulation
3. **Same semantic structure**: foreground variants for each color

To adopt in an existing shadcn/ui project:

1. Replace the `:root` and `.dark` blocks in your `globals.css` with content from `tokens.css`
2. Keep your existing Tailwind config (it should already map to these variables)
3. Optionally update component styles to match Loop-Vesper aesthetics

---

## Token Categories

### Colors

| Token                    | Light Mode             | Dark Mode              |
|--------------------------|------------------------|------------------------|
| `--background`           | Warm cream #FAF8F5     | Deep dark #141414      |
| `--foreground`           | Charcoal #1A1A1A       | Near white #FAFAFA     |
| `--primary`              | Purple #6B26B8         | Mint green #B3FFD1     |
| `--secondary`            | Warm gray #F2EDE6      | Dark gray #292929      |
| `--muted`                | Light gray #EBE7E2     | Dark gray #2E2E2E      |
| `--accent`               | Purple #6B26B8         | Mint green #B3FFD1     |
| `--destructive`          | Red #DC2626            | Bright red #E53E3E     |
| `--border`               | Soft border #E5E2DD    | Subtle border #333333  |

### Typography

- **Primary font**: Space Grotesk
- **Display font**: Avantt (bold headlines)
- **Fallback stack**: ui-sans-serif, system-ui, -apple-system, sans-serif

### Radius

- **Base radius**: 0.75rem (12px) - more rounded, friendly aesthetic
- **Derived**: `calc(var(--radius) - 2px)` for medium, `calc(var(--radius) - 4px)` for small

### Motion

- **Default duration**: 200ms
- **All color transitions**: Applied globally via `transition-colors duration-200`
- **Easing**: ease-out for entrances, ease-in for exits

### Shadows

Soft, low-opacity shadows for a refined look:

```css
.shadow-sm  { /* 4% max opacity */ }
.shadow     { /* 6% max opacity */ }
.shadow-lg  { /* 8% max opacity */ }
```

---

## Source of Truth

**The canonical source of design tokens is `src/app/globals.css` in the Loop-Vesper repository.**

This `design-system/` folder is a **derived artifact** for sharing. When the main codebase evolves:

1. Update `src/app/globals.css` first
2. Re-extract tokens to this folder
3. Bump version in `tokens.json` metadata

### Sync Checklist

When updating design tokens:

- [ ] Modify `src/app/globals.css` (source of truth)
- [ ] Update `design-system/tokens.css` to match
- [ ] Update `design-system/tokens.json` with new values and hex equivalents
- [ ] Update `design-system/principles.md` if design philosophy changed
- [ ] Bump version in `tokens.json` `$metadata.version`
- [ ] Note changes in version history section of `principles.md`

---

## Font Files

The design system references these fonts:

| Font          | Weight(s) | Source                                |
|---------------|-----------|---------------------------------------|
| Space Grotesk | 400-700   | Google Fonts (imported via CSS)       |
| Avantt        | 700 Bold  | Local files (`/fonts/Avantt-Bold.*`)  |

For projects using Avantt, copy the font files and add the `@font-face` declaration:

```css
@font-face {
  font-family: 'Avantt';
  src: url('/fonts/Avantt-Bold.woff') format('woff'),
       url('/fonts/Avantt-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

---

## Framework Examples

### React / Next.js

```tsx
// components/Button.tsx
export function Button({ children, variant = 'primary' }) {
  const baseClasses = "px-4 py-2 rounded-md transition-colors duration-200";
  
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "bg-transparent hover:bg-muted",
  };
  
  return (
    <button className={`${baseClasses} ${variants[variant]}`}>
      {children}
    </button>
  );
}
```

### Vue

```vue
<template>
  <button :class="['btn', `btn--${variant}`]">
    <slot />
  </button>
</template>

<style scoped>
.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  transition: all var(--duration-normal) var(--ease-out);
}

.btn--primary {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.btn--primary:hover {
  background: hsl(var(--primary) / 0.9);
}
</style>
```

### Plain CSS

```css
.card {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: var(--space-4);
  box-shadow: 
    0 4px 6px -1px rgba(0, 0, 0, 0.06),
    0 2px 4px -1px rgba(0, 0, 0, 0.03);
}

.card:hover {
  border-color: hsl(var(--primary) / 0.3);
}
```

---

## Version

Current version: **1.0.0** (2026-02-03)

See `principles.md` for version history and changelog.

---

## Questions?

Refer to `principles.md` for detailed design philosophy, or check the main Loop-Vesper repository for implementation examples.
