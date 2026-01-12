# Latentia

Your intelligent AI canvas for generating images and videos with state-of-the-art AI models.

## Overview

Latentia is a next-generation generative AI web platform that provides a unified interface for multiple AI image and video generation models. Unlike existing tools, Latentia introduces a project-centric organizational structure that enables teams to collaborate effectively on creative work.

## Features Implemented

### Phase 1: Foundation ✅

- ✅ Next.js 14 with TypeScript and App Router
- ✅ Tailwind CSS with custom dark theme
- ✅ Supabase integration (client and server)
- ✅ Prisma ORM with PostgreSQL schema
- ✅ shadcn/ui component library
- ✅ Authentication pages (login, signup)
- ✅ Protected routes middleware

### Phase 2: Project Management ✅

- ✅ Project dashboard with grid layout
- ✅ New project creation dialog
- ✅ Project cards with metadata
- ✅ Session management system
- ✅ Session sidebar with filtering

### Phase 3: Generation Interface ✅

- ✅ Chat-based generation UI
- ✅ Generation gallery with grid layout
- ✅ Chat input with parameter controls
- ✅ Model picker with pinning capability
- ✅ Parameter controls (aspect ratio, resolution, outputs)
- ✅ Image/Video mode toggle
- ✅ Hover overlay with action buttons (download, star, delete, reuse)
- ✅ Reuse parameters functionality

### Phase 4: Model Integrations ✅

- ✅ Model adapter architecture (BaseModelAdapter)
- ✅ Gemini 2.5 Flash Image (Nano Banana) for image generation
- ✅ Gemini Veo 3.1 for video generation
- ✅ Replicate Seedream 4.0 integration
- ✅ FAL.ai Seedream 4 integration
- ✅ Realtime generation updates
- ✅ Background processing architecture
- ✅ Optimistic UI updates
- ✅ Generation status polling

### Phase 5: Prompt Enhancement ✅

- ✅ AI-powered prompt enhancement using Claude Sonnet 4.5
- ✅ Model-specific enhancement strategies
- ✅ Reference image analysis for image-to-image workflows
- ✅ Video-specific best practices (Veo 3.1 guidelines)
- ✅ Admin panel for managing system prompts
- ✅ User role management (admin/user)

### Phase 6: Performance Optimizations ✅

- ✅ Optimized database queries (single-query joins for thumbnails)
- ✅ Infinite scroll for generations (cursor-based pagination)
- ✅ Aggressive React Query caching (5min projects, 3min sessions)
- ✅ Hover prefetching for faster navigation
- ✅ Image compression for reference uploads
- ✅ GCS URI support for video downloads
- ✅ Real-time subscriptions via Supabase Realtime
- ✅ Optimistic updates for instant feedback

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui
- **State Management**: React Query (TanStack Query)
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL + Prisma ORM)
- **Authentication**: Supabase Auth with role-based access
- **Storage**: Supabase Storage (with CDN)
- **Real-time**: Supabase Realtime subscriptions
- **AI APIs**: Google Gemini, Anthropic Claude, Replicate, FAL.ai
- **Canvas**: React Flow (for node interface - future)

## Getting Started

### Prerequisites

- Node.js 18+ (preferably 20+)
- npm or pnpm
- Supabase account

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd latentia
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Then edit `.env.local` with your Supabase credentials:
```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=your-database-url

# AI API Keys (required for generation features)
GEMINI_API_KEY=your-gemini-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key
REPLICATE_API_TOKEN=your-replicate-token
FAL_KEY=your-fal-key

# Kling Official API (for frame-to-frame video interpolation)
# Get your keys from: https://app.klingai.com/global/dev/document-api
KLING_ACCESS_KEY=your-kling-access-key
KLING_SECRET_KEY=your-kling-secret-key
```

4. Set up the database:
```bash
npm run prisma:push
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
latentia/
├── app/                      # Next.js app directory
│   ├── (auth)/              # Authentication pages
│   │   ├── login/
│   │   └── signup/
│   ├── projects/            # Projects pages
│   │   ├── [id]/           # Individual project page
│   │   └── page.tsx        # Projects dashboard
│   ├── auth/
│   │   └── callback/       # OAuth callback handler
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── projects/            # Project-related components
│   ├── sessions/            # Session-related components
│   └── generation/          # Generation interface components
├── lib/
│   ├── supabase/           # Supabase client configuration
│   └── utils.ts            # Utility functions
├── types/                   # TypeScript type definitions
├── prisma/
│   └── schema.prisma       # Database schema
└── middleware.ts           # Route protection middleware
```

## Database Schema

The database includes the following main tables:

- **profiles**: User profiles
- **projects**: Top-level project containers
- **project_members**: Collaboration/sharing
- **sessions**: Individual workstreams within projects
- **generations**: Generation requests
- **outputs**: Generated images/videos
- **models**: AI model configurations
- **user_model_pins**: User's pinned models
- **workflows**: Node-based workflows (future)

## Next Steps (Future Features)

### Future Enhancements

- [ ] Additional model integrations (Flux Pro, Stable Diffusion 3, etc.)
- [ ] Real-time collaboration with multiplayer cursors
- [ ] Node-based interface with React Flow
- [ ] Advanced image editing tools
- [ ] Generation history search and filtering
- [ ] Batch download and export
- [ ] Advanced metadata panel
- [ ] Mobile responsive design improvements

### Polish & Production

- [ ] Comprehensive testing suite (unit, integration, E2E)
- [ ] Error tracking (Sentry)
- [ ] Analytics (Posthog or Vercel Analytics)
- [ ] Custom domain and branding
- [ ] User documentation and tutorials

## Contributing

This is a private project currently in active development.

## License

Proprietary - All rights reserved

## Documentation

### Core Documentation
- [Product Requirements Document](./PRD.md)
- [Technical Architecture](./ARCHITECTURE.md)
- [Performance Implementation Summary](./PERFORMANCE_IMPLEMENTATION_SUMMARY.md)

### Setup Guides
- [Quick Start Guide](./QUICKSTART.md)
- [Environment Setup](./SETUP.md)
- [Database Setup](./VERCEL_DATABASE_SETUP.md)
- [Gemini API Setup](./GEMINI_SETUP.md)
- [Replicate Setup](./REPLICATE_SETUP.md)
- [FAL.ai Setup](./FAL_SETUP.md)

### Feature Documentation
- [Prompt Enhancement System](./PROMPT_ENHANCEMENT_FEATURE.md)
- [User Roles & Admin Panel](./USER_ROLES_SETUP.md)
- [Performance Optimization Plan](./PRE_REFACTORING_II_PERFORMANCE_PLAN.md)

---

Built with ❤️ using Next.js and Supabase

