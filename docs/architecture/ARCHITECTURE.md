# Latentia - Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  Next.js 14 App (React 18 + TypeScript)                         │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Chat Interface  │  │  Node Interface  │                    │
│  │  (Main UI)       │  │  (React Flow)    │                    │
│  └──────────────────┘  └──────────────────┘                    │
│  ┌─────────────────────────────────────────┐                   │
│  │  Shared UI Components (shadcn/ui)       │                   │
│  │  • Project Grid  • Session Sidebar      │                   │
│  │  • Model Picker  • Generation Gallery   │                   │
│  └─────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────┐                   │
│  │  State Management (Zustand)             │                   │
│  └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                            ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  Next.js API Routes (Serverless Functions on Vercel)            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │   /api/auth  │ │ /api/projects│ │ /api/generate│           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │/api/sessions │ │ /api/models  │ │ /api/outputs │           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
│                                                                  │
│  ┌─────────────────────────────────────────┐                   │
│  │  Business Logic Layer                   │                   │
│  │  • Project Manager                      │                   │
│  │  • Generation Orchestrator              │                   │
│  │  • Model Registry                       │                   │
│  └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                            ↕ Prisma ORM
┌─────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  Supabase (Backend as a Service)                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  PostgreSQL Database                     │                  │
│  │  • projects  • sessions  • generations   │                  │
│  │  • outputs   • models    • workflows     │                  │
│  └──────────────────────────────────────────┘                  │
│  ┌──────────────────────────────────────────┐                  │
│  │  Supabase Auth                           │                  │
│  │  • Email/Password • Magic Link • OAuth   │                  │
│  └──────────────────────────────────────────┘                  │
│  ┌──────────────────────────────────────────┐                  │
│  │  Supabase Storage (S3)                   │                  │
│  │  • Generated images  • Generated videos  │                  │
│  │  • User uploads      • Thumbnails        │                  │
│  └──────────────────────────────────────────┘                  │
│  ┌──────────────────────────────────────────┐                  │
│  │  Supabase Realtime (WebSocket)           │                  │
│  │  • Live generations  • Multiplayer       │                  │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                            ↕ HTTPS
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Replicate API   │  │  Black Forest    │                    │
│  │  • Flux          │  │  Labs API        │                    │
│  │  • SD 3.5        │  │  • Flux Direct   │                    │
│  └──────────────────┘  └──────────────────┘                    │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Minimax API     │  │  Seedream API    │                    │
│  │  • Nano Banana   │  │  • Seedream 4.0  │                    │
│  │  • Video Gen     │  │  • Seedance      │                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Image Generation

```
User enters prompt
      ↓
[Chat Interface]
      ↓
User clicks "Generate"
      ↓
[Frontend] POST /api/generate/image
      ↓
[API Route] Validates request
      ↓
[Business Logic] Creates generation record in DB
      ↓
[Model Adapter] Formats request for specific model API
      ↓
[External API] Generates image(s)
      ↓ (webhook or polling)
[API Route] Receives completion
      ↓
[Storage] Uploads images to Supabase Storage
      ↓
[Database] Updates generation record with URLs
      ↓
[Realtime] Broadcasts update via WebSocket
      ↓
[Frontend] Receives update, displays images in gallery
```

## File Structure

```
latentia/
├── app/                          # Next.js 14 App Router
│   ├── (auth)/
│   │   ├── login/
│   │   ├── signup/
│   │   └── callback/
│   ├── (dashboard)/
│   │   ├── page.tsx              # Home/Projects page
│   │   └── projects/
│   │       └── [id]/
│   │           └── page.tsx      # Generation interface
│   ├── api/                      # API routes
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── sessions/
│   │   ├── generate/
│   │   │   ├── image/
│   │   │   └── video/
│   │   ├── models/
│   │   └── outputs/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── chat/
│   │   ├── ChatInput.tsx
│   │   ├── GenerationGallery.tsx
│   │   └── ModelPicker.tsx
│   ├── nodes/
│   │   ├── NodeCanvas.tsx
│   │   ├── NodeLibrary.tsx
│   │   └── nodes/
│   │       ├── PromptNode.tsx
│   │       ├── ModelNode.tsx
│   │       └── OutputNode.tsx
│   ├── projects/
│   │   ├── ProjectGrid.tsx
│   │   └── ProjectCard.tsx
│   ├── sessions/
│   │   └── SessionSidebar.tsx
│   └── shared/
│       ├── Header.tsx
│       └── LoadingState.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── types.ts
│   ├── models/
│   │   ├── registry.ts           # Model registry
│   │   ├── adapters/
│   │   │   ├── flux.ts
│   │   │   ├── seedream.ts
│   │   │   ├── nanoBanana.ts
│   │   │   └── base.ts
│   │   └── types.ts
│   ├── api/
│   │   ├── projects.ts
│   │   ├── sessions.ts
│   │   └── generations.ts
│   └── utils/
│       ├── image.ts
│       └── validation.ts
├── store/
│   ├── projectStore.ts
│   ├── sessionStore.ts
│   └── uiStore.ts
├── types/
│   ├── project.ts
│   ├── session.ts
│   ├── generation.ts
│   └── model.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/
│   └── models/
│       └── configs/              # Model JSON configs
│           ├── flux.json
│           ├── seedream.json
│           └── ...
├── .env.local                    # Environment variables
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## Key Technology Decisions

### Why Next.js 14 App Router?
- **Server Components**: Reduce client bundle size
- **Server Actions**: Simplified API calls
- **Streaming**: Progressive UI updates
- **Edge Runtime**: Fast cold starts on Vercel
- **Built-in optimization**: Image, font, script optimization

### Why Supabase?
- **All-in-one**: Database, Auth, Storage, Realtime
- **PostgreSQL**: Robust, scalable, ACID compliant
- **Row-Level Security**: Built-in authorization
- **Real-time subscriptions**: WebSocket out of the box
- **Generous free tier**: Great for MVP

### Why Prisma?
- **Type safety**: Auto-generated TypeScript types
- **Migrations**: Version-controlled schema changes
- **Query builder**: Intuitive, less SQL
- **Works well with Supabase**: Can connect to Supabase's PostgreSQL

### Why Zustand?
- **Lightweight**: 1KB minified
- **No boilerplate**: Unlike Redux
- **React hooks**: Natural integration
- **DevTools**: Time-travel debugging

### Why React Flow?
- **Purpose-built**: Best library for node-based UIs
- **Performant**: Handles 100+ nodes
- **Customizable**: Full control over node rendering
- **Active community**: Well-maintained

## Security Considerations

### API Key Management
```typescript
// NEVER expose API keys to client
// ❌ Bad
const response = await fetch('https://api.model.com', {
  headers: { 'Authorization': `Bearer ${process.env.NEXT_PUBLIC_API_KEY}` }
});

// ✅ Good - API keys only in server-side code
// /app/api/generate/route.ts
export async function POST(req: Request) {
  const apiKey = process.env.MODEL_API_KEY; // Not exposed to client
  // ... make request
}
```

### Row-Level Security (RLS)
```sql
-- Users can only see their own projects or shared projects
CREATE POLICY "Users can view own and shared projects"
ON projects FOR SELECT
USING (
  auth.uid() = owner_id 
  OR 
  id IN (
    SELECT project_id FROM project_members WHERE user_id = auth.uid()
  )
);
```

### File Upload Validation
```typescript
// Validate file type and size
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error('Invalid file type');
}
if (file.size > MAX_SIZE) {
  throw new Error('File too large');
}
```

## Performance Optimization

### Image Optimization
- Use Next.js `<Image>` component
- Serve WebP with JPEG fallback
- Lazy load gallery images
- Generate thumbnails (256x256) for fast loading
- CDN caching (Vercel Edge Network)

### Code Splitting
- Dynamic imports for heavy components
```typescript
const NodeCanvas = dynamic(() => import('@/components/nodes/NodeCanvas'), {
  ssr: false,
  loading: () => <LoadingSpinner />
});
```

### Database Optimization
- Index frequently queried columns
```sql
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_generations_session_id ON generations(session_id);
CREATE INDEX idx_outputs_generation_id ON outputs(generation_id);
```

### Caching Strategy
- Static assets: Cache-Control: public, max-age=31536000, immutable
- Generated images: Cache-Control: public, max-age=604800 (1 week)
- API responses: Revalidate on demand with Next.js ISR

## Deployment Architecture (Vercel)

```
User Request
      ↓
[Vercel Edge Network] (CDN)
      ↓
[Next.js Middleware] (Auth check)
      ↓
[Next.js SSR] (Server-side rendering)
      ↓
[API Routes] (Serverless functions)
      ↓
[Supabase] (External service)
```

### Environment Variables
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Model APIs
REPLICATE_API_TOKEN=xxx          # For Replicate models (recommended)
REPLICATE_API_KEY=xxx           # Legacy support
BLACK_FOREST_LABS_API_KEY=xxx
MINIMAX_API_KEY=xxx

# Others
NEXT_PUBLIC_APP_URL=https://latentia.ai
```

**Model Integration Documentation:**
- [Replicate Setup](./REPLICATE_SETUP.md) - Detailed guide for Replicate integration
- [FAL.ai Setup](./FAL_SETUP.md) - FAL.ai adapter guide
- [Gemini Setup](./GEMINI_SETUP.md) - Google Gemini integration

### Vercel Configuration
```json
{
  "buildCommand": "prisma generate && next build",
  "devCommand": "next dev",
  "installCommand": "pnpm install",
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "DATABASE_URL": "@database-url"
  }
}
```

## Monitoring & Observability

### Error Tracking
- **Sentry**: Capture and report errors
- **Custom error boundaries**: Graceful degradation

### Analytics
- **Posthog**: User behavior analytics
- **Custom events**:
  - `generation_created`
  - `project_shared`
  - `model_selected`
  - `parameters_reused`

### Logging
- **Console logs**: Development only
- **Structured logs**: Production (JSON format)
- **Log levels**: ERROR, WARN, INFO, DEBUG

### Uptime Monitoring
- **Vercel Analytics**: Built-in monitoring
- **Ping endpoints**: Health check routes

## Scalability Plan

### Current (Phase 1)
- **Users**: 100-1,000
- **Requests**: 1K/day
- **Storage**: 10GB
- **Cost**: ~$100/month

### Growth (Phase 2)
- **Users**: 10,000
- **Requests**: 100K/day
- **Storage**: 1TB
- **Cost**: ~$1,000/month
- **Optimization**: Implement Redis caching

### Scale (Phase 3)
- **Users**: 100,000+
- **Requests**: 1M+/day
- **Storage**: 10TB+
- **Cost**: ~$10,000/month
- **Optimization**: 
  - Separate generation queue (BullMQ)
  - CDN for all assets
  - Database read replicas
  - Horizontal scaling

---

**Last Updated**: October 24, 2025

