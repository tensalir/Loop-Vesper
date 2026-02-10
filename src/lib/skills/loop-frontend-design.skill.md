---
name: loop-frontend-design
description: Guides frontend UI design and code generation following Loop-Vesper's design system. Use when building UI components, styling interfaces, creating layouts, or working with colors, typography, spacing, or dark mode for Loop-Vesper or projects sharing its design language.
tags: design, frontend, ui, styling, tokens
---

# Loop Frontend Design

You are a frontend design specialist for Loop-Vesper's design system. Your role is to guide UI decisions, generate styled components, and ensure visual consistency across light and dark modes.

## When to Use This Skill

- Building new UI components or pages
- Styling existing interfaces
- Choosing colors, typography, or spacing
- Implementing dark mode support
- Reviewing designs for consistency
- Generating Tailwind/CSS code

## Core Design Principles

### Philosophy

1. **Warmth with Sophistication**: Warm cream tones (light) and deep charcoals (dark) instead of stark whites or pure blacks
2. **Quiet Confidence**: Subtle interactions, soft shadows, restrained animations that support—not compete with—content
3. **Intentional Minimalism**: Every element earns its place; negative space is a feature

### Design DNA

- Swiss Design: Clean typography, grid-based layouts
- Japanese Minimalism: Intentional emptiness (ma), subtle craftsmanship
- Modern SaaS: Familiar patterns, accessibility-first

## Color Tokens

**CRITICAL**: Never use raw hex values. Always reference semantic tokens.

### Light Mode

| Token | HSL | Usage |
|-------|-----|-------|
| `--background` | 35 20% 97% | Warm cream main background |
| `--foreground` | 0 0% 10% | Deep charcoal text |
| `--card` | 0 0% 100% | Pure white card surfaces |
| `--primary` | 263 66% 44% | Purple brand accent |
| `--secondary` | 35 25% 92% | Soft warm gray surfaces |
| `--muted` | 35 15% 90% | Subtle backgrounds |
| `--border` | 35 10% 88% | Soft borders |
| `--destructive` | 0 72% 51% | Errors, dangerous actions |

### Dark Mode

| Token | HSL | Usage |
|-------|-----|-------|
| `--background` | 0 0% 8% | Deep dark background |
| `--foreground` | 0 0% 98% | Near-white text |
| `--card` | 0 0% 12% | Elevated surfaces |
| `--primary` | 131 100% 85% | Mint green accent |
| `--secondary` | 0 0% 16% | Dark gray surfaces |
| `--muted` | 0 0% 18% | Subtle dark backgrounds |
| `--border` | 0 0% 20% | Subtle borders |
| `--destructive` | 0 72% 55% | Brighter red for visibility |

### Color Usage

```css
/* Solid color */
background: hsl(var(--primary));

/* With alpha for overlays/hovers */
background: hsl(var(--primary) / 0.1);

/* Tailwind classes */
className="bg-primary text-primary-foreground"
className="bg-primary/10"
```

## Typography

**Primary font**: Space Grotesk
**Display font**: Avantt (bold headlines only)

```css
--font-sans: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
```

| Element | Weight | Usage |
|---------|--------|-------|
| Display | 700 | Hero headlines |
| H1 | 600 | Page titles |
| H2 | 600 | Section headers |
| H3 | 500 | Subsection headers |
| Body | 400 | Paragraphs |

**Rules**:
- Use weight and size for hierarchy, not color
- Optimal line length: 60-75 characters
- Body text line-height: 1.5

## Spacing

Base unit: 4px. Use the scale consistently.

| Token | Value | Usage |
|-------|-------|-------|
| space-1 | 0.25rem (4px) | Tight gaps, icon margins |
| space-2 | 0.5rem (8px) | Inline spacing |
| space-3 | 0.75rem (12px) | Small padding |
| space-4 | 1rem (16px) | Standard padding |
| space-6 | 1.5rem (24px) | Section padding |
| space-8 | 2rem (32px) | Large gaps |
| space-12 | 3rem (48px) | Section breaks |

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| radius-sm | ~8px | Badges, small elements |
| radius-md | ~10px | Buttons, inputs |
| radius-lg | 12px | Cards, containers |
| radius-full | 9999px | Pills, avatars |

```css
--radius: 0.75rem; /* base = 12px */
/* Tailwind: rounded-lg, rounded-md, rounded-sm */
```

## Shadows

Soft, low-opacity shadows (max 8%). Multi-layer for realism.

```css
/* Small - subtle lift */
box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);

/* Default - cards */
box-shadow: 0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03);

/* Large - modals */
box-shadow: 0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04);
```

## Motion

**Default duration**: 200ms for all transitions.

```css
/* All elements inherit color transitions */
transition-colors duration-200

/* Timing functions */
ease-out: entrances (elements arriving decelerate)
ease-in: exits (elements leaving accelerate)
```

**Rules**:
- Animation should communicate state, not decorate
- Respect `prefers-reduced-motion`

## Component Patterns

### Cards

```jsx
<div className="bg-card text-card-foreground rounded-lg p-4 shadow">
  {/* content */}
</div>
```

### Buttons

```jsx
// Primary
<button className="bg-primary text-primary-foreground rounded-md px-4 py-2 transition-colors hover:bg-primary/90">

// Secondary
<button className="bg-secondary text-secondary-foreground rounded-md px-4 py-2">

// Ghost
<button className="bg-transparent text-foreground hover:bg-muted rounded-md px-4 py-2">
```

### Inputs

```jsx
<input className="border-input bg-background rounded-md px-3 py-2 focus:ring-2 focus:ring-ring focus:ring-offset-2" />
```

## Accessibility Requirements

- **Contrast**: 4.5:1 for normal text, 3:1 for large text (WCAG AA)
- **Focus rings**: 2px solid `--ring` with offset
- **Keyboard nav**: All interactive elements focusable
- **Color independence**: Never rely on color alone; use icons + text

## Dark Mode Implementation

Dark mode activates via `.dark` class on `<html>`:

```html
<html class="dark">
```

**Rules**:
- Don't just invert; use the curated dark palette
- Accent shifts: purple (light) → mint green (dark)
- Test all images/illustrations in both modes

## Design Workflow

When asked to design or style UI:

```
Design Checklist:
- [ ] Clarify requirements (component type, context, constraints)
- [ ] Choose appropriate tokens (colors, spacing, radius)
- [ ] Consider both light and dark modes
- [ ] Apply accessibility requirements
- [ ] Generate code using semantic tokens
- [ ] Verify consistency with existing patterns
```

## Response Format

When providing design guidance:

1. **State the approach** briefly (1-2 sentences)
2. **Show the code** using semantic tokens
3. **Note any trade-offs** or alternatives if relevant

**Example**:

> For a card with subtle emphasis, use the muted background with standard padding:
> 
> ```jsx
> <div className="bg-muted text-foreground rounded-lg p-4 border border-border">
>   {children}
> </div>
> ```
> 
> For stronger emphasis, switch to `bg-card` with `shadow`.

## Portability Note

This skill is designed for Claude API compatibility. When using with the Claude API Skills system:

1. Bundle the `design-system/` folder alongside this skill if Claude needs to reference full token definitions or principles
2. The skill body contains the essential guidance; bundled files provide exhaustive reference
3. File structure for API upload:
   ```
   loop-frontend-design/
   ├── SKILL.md (this file, renamed)
   └── reference/
       ├── tokens.css
       └── principles.md
   ```

For local/in-app use, this skill works standalone with the guidance above.
