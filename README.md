# Vesper

> Internal AI image and video generation platform for Loop Earplugs. Built for the Studio team, by embedding into their workflow and removing the bottlenecks one at a time.

## Why this exists

Through 2025, Loop ran dozens of AI image and video campaigns. The workflow was: write a prompt in ChatGPT or Claude, paste it into Krea or another platform, iterate, repeat. Three problems with that.

First, platforms like Krea take a margin on every API call. Defensible business model, but not transparent and expensive at campaign scale. Second, switching between an LLM for prompt writing and a separate tool for generation breaks the flow state. Every tab switch is a context switch. Third, the features our team actually needed (prompt enhancement linked to our product catalogue, image-to-video without leaving the page, PDF image extraction for briefing assets) were not available in any off-the-shelf tool and may never be, because they only matter for our specific workflow.

Vesper exists to close those gaps. Software for a team of ten, not a platform for the industry.

## What it does

A project-based workspace where the Studio team generates images and videos across multiple models (Gemini, Replicate, FAL.ai, Kling) with a built-in prompt enhancer powered by Claude. Sessions function as scoped workspaces within a project. Every generation is tracked, every output stored.

## Key capabilities

**Prompt enhancement.** Claude-powered prompt refinement with model-specific strategies and reference image analysis. Linked to the Loop product catalogue so prompts stay on-brand without manual copy-paste.

**Multi-model generation.** Adapter architecture supporting Gemini Flash Image, Veo 3.1, Replicate Seedream, FAL.ai Seedream, and Kling. Switch models without switching tools.

**Animate still.** A popup that lets you go from image to video without leaving the page. A small thing in isolation, but in a production flow where you are constantly evaluating images and deciding which to animate, it removes a real friction point.

**PDF image extraction.** Stakeholders and brief owners send Word documents and PDFs. Instead of manually copying images out of those files, Vesper extracts them directly for use as reference images.

**Real-time feedback.** Supabase Realtime subscriptions, optimistic UI updates, and infinite scroll so the team can generate fast and review faster.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| State | React Query (TanStack Query) |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL + Prisma ORM) |
| Auth | Supabase Auth with role-based access |
| Storage | Supabase Storage (CDN) |
| Real-time | Supabase Realtime subscriptions |
| AI | Google Gemini, Anthropic Claude, Replicate, FAL.ai, Kling |

```
app/                      # Next.js pages
  (auth)/                 # Login, signup
  projects/               # Dashboard and project detail
components/
  projects/               # Project cards, creation
  sessions/               # Session sidebar, filtering
  generation/             # Gallery, prompt bar, model picker
lib/
  supabase/               # Client configuration
prisma/
  schema.prisma           # Database schema
```

## Getting started

Prerequisites: Node.js 18+, Supabase account.

```bash
git clone https://github.com/tensalir/Loop-Vesper.git
cd Loop-Vesper
npm install
cp .env.example .env.local
```

Add your keys to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
REPLICATE_API_TOKEN=...
FAL_KEY=...
KLING_ACCESS_KEY=...
KLING_SECRET_KEY=...
```

```bash
npm run prisma:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Documentation

- [Product Requirements](./PRD.md)
- [Architecture](./ARCHITECTURE.md)
- [Quick Start](./QUICKSTART.md)
- [Gemini Setup](./GEMINI_SETUP.md)
- [Replicate Setup](./REPLICATE_SETUP.md)
- [FAL.ai Setup](./FAL_SETUP.md)
- [Prompt Enhancement](./PROMPT_ENHANCEMENT_FEATURE.md)
- [User Roles](./USER_ROLES_SETUP.md)

## What comes next

More model integrations as they mature, batch operations for campaign-scale generation, and tighter feedback loops between generation output and briefing context. The roadmap is driven by what the team asks for, not by a feature checklist.
