---
name: Renders Feature + Build Fix
overview: Add a dedicated "Renders" button for quick access to product renders with Frontify integration and local Supabase fallback, plus fix the Vercel build error.
todos:
  - id: fix-build
    content: Fix TypeScript error in backfill-reference-images/route.ts
    status: completed
  - id: db-schema
    content: Add ProductRender model to Prisma schema and create migration
    status: completed
    dependencies:
      - fix-build
  - id: api-list
    content: Create GET /api/product-renders endpoint for listing renders
    status: completed
    dependencies:
      - db-schema
  - id: api-admin
    content: Create admin CRUD endpoints for product renders
    status: completed
    dependencies:
      - db-schema
  - id: frontify-lib
    content: Create Frontify API client library with env var setup
    status: completed
    dependencies:
      - db-schema
  - id: browse-modal
    content: Create ProductRendersBrowseModal component with search and filters
    status: completed
    dependencies:
      - api-list
  - id: renders-button
    content: Add Renders button to ChatInput and VideoInput components
    status: completed
    dependencies:
      - browse-modal
  - id: admin-ui
    content: Create RendersManagementSettings component with upload form
    status: completed
    dependencies:
      - api-admin
  - id: settings-tab
    content: Add Renders tab to Settings page (admin-only)
    status: completed
    dependencies:
      - admin-ui
---

# Renders Feature Implementation

## Overview

Add a dedicated "Renders" button in the generation input bar that provides quick access to product renders. The system will integrate with Frontify API for existing assets and fall back to a Supabase bucket for new uploads. Includes an admin interface for managing product renders.

## Architecture

```mermaid
flowchart TB
    subgraph Frontend
        RB[Renders Button] --> PRM[ProductRendersBrowseModal]
        PRM --> API[/api/product-renders]
        Settings[Settings Page] --> AdminTab[Admin: Renders Tab]
        AdminTab --> AdminAPI[/api/admin/product-renders]
    end
    
    subgraph Backend
        API --> FrontifyLib[Frontify Service]
        API --> Prisma[Prisma: ProductRender]
        AdminAPI --> Supabase[Supabase Bucket]
        AdminAPI --> Prisma
        FrontifyLib --> FrontifyAPI[Frontify API]
    end
    
    subgraph Storage
        Supabase --> Bucket[product-renders bucket]
        FrontifyAPI --> FrontifyAssets[Frontify Assets]
    end
```

---

## 1. Build Fix (Priority)

Fix the TypeScript error in [`app/api/admin/backfill-reference-images/route.ts`](app/api/admin/backfill-reference-images/route.ts):

```typescript
// Line 147: Cast newParams to Prisma.InputJsonValue
data: { parameters: newParams as Prisma.InputJsonValue }
```

---

## 2. Database Schema

Add new `ProductRender` model to [`prisma/schema.prisma`](prisma/schema.prisma):

```prisma
model ProductRender {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   // Product name (e.g., "MCL38")
  colorway    String?  // Colorway (e.g., "Papaya Orange")
  imageUrl    String   @map("image_url")
  storagePath String?  @map("storage_path") // Supabase path
  source      String   @default("local") // "local" or "frontify"
  frontifyId  String?  @map("frontify_id") // Frontify asset ID
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([name])
  @@index([source])
  @@map("product_renders")
}
```

---

## 3. Frontend Components

### 3.1 Renders Button in ChatInput

Add button to [`components/generation/ChatInput.tsx`](components/generation/ChatInput.tsx) between the image popover and aspect ratio:

- Use Loop logo icon (`/images/loop logo_standalone - white.png` or a simple white circle SVG)
- Direct click opens `ProductRendersBrowseModal` (no hover menu)

### 3.2 ProductRendersBrowseModal

New component at `components/generation/ProductRendersBrowseModal.tsx`:

- Search bar at top (filter by product name)
- Filter chips showing unique product names for quick filtering
- Grid layout with product render thumbnails
- On select: passes image URL to parent (same pattern as `ImageBrowseModal`)

### 3.3 Admin Settings Tab

Add "Renders" tab to [`app/settings/page.tsx`](app/settings/page.tsx) (admin-only):New component at `components/settings/RendersManagementSettings.tsx`:

- Upload form: product name, colorway (optional), image file
- Table/grid of existing renders with edit/delete actions
- Sync button for Frontify (when credentials available)

---

## 4. API Routes

| Route | Method | Purpose |

|-------|--------|---------|

| `/api/product-renders` | GET | List all renders with optional search/filter |

| `/api/admin/product-renders` | POST | Upload new render (admin) |

| `/api/admin/product-renders/[id]` | PUT | Update render metadata (admin) |

| `/api/admin/product-renders/[id]` | DELETE | Delete render (admin) |

| `/api/frontify/assets` | GET | Proxy to Frontify API (future) |---

## 5. Frontify Integration

Create [`lib/frontify/client.ts`](lib/frontify/client.ts):

- Environment variables: `FRONTIFY_API_TOKEN`, `FRONTIFY_PROJECT_ID`
- Search/filter assets by tags, folders
- Transform Frontify assets to `ProductRender` format
- Graceful fallback when credentials unavailable

---

## 6. Supabase Bucket

Create new bucket `product-renders` in Supabase:

- Public access for reading
- Authenticated upload via service role
- Path pattern: `products/{product-name}/{filename}.png`

---

## Files to Create/Modify

| File | Action |

|------|--------|

| `prisma/schema.prisma` | Add ProductRender model |

| `prisma/migrations/...` | New migration |

| `components/generation/ProductRendersBrowseModal.tsx` | Create |

| `components/generation/ChatInput.tsx` | Add Renders button |

| `components/generation/VideoInput.tsx` | Add Renders button |

| `components/settings/RendersManagementSettings.tsx` | Create |

| `app/settings/page.tsx` | Add Renders tab |

| `app/api/product-renders/route.ts` | Create |

| `app/api/admin/product-renders/route.ts` | Create |

| `app/api/admin/product-renders/[id]/route.ts` | Create |

| `lib/frontify/client.ts` | Create |