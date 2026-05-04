# Vesper

> Internal AI image and video platform for the Loop Earplugs Studio team. Built by embedding into the workflow and removing one bottleneck at a time, not by selling another tool to the industry.

## What this repo is

Vesper is a project-based generation workspace where the Studio team writes prompts, runs them across multiple image and video models, refines through a Claude-powered prompt enhancer, and reviews everything in a real-time gallery. Sessions act as scoped sub-workspaces inside a project so a designer can keep ten parallel explorations without losing track of the through-line.

It is also the repo where Loop's "encoding" idea first showed up at runtime: the same Claude Skill that the team uses inside Claude.ai for prompt writing sits behind Vesper's enhance button. Same intelligence, different surface.

## Why it exists

Through 2025, Loop ran dozens of AI image and video campaigns. The workflow was: write a prompt in ChatGPT or Claude, paste it into Krea or another platform, iterate, repeat. Three problems with that. Krea's margin-on-API-calls model was expensive and opaque at campaign scale. Switching tabs between an LLM and a generation tool broke flow. The features the Studio team actually needed (prompt enhancement linked to the Loop product catalogue, image-to-video without leaving the page, image extraction from briefing PDFs) were not in any off-the-shelf tool and likely never will be, because they only matter for this team's workflow.

Vesper is the response. Software for a team of ten, not a platform for the industry.

## What it does

- Project- and session-scoped generation workspace with infinite-scroll gallery and Supabase Realtime updates.
- Prompt enhancement powered by Claude with model-specific strategies and reference image analysis. Linked to the Loop product catalogue so prompts stay on-brand without manual copy-paste.
- Multi-model generation: Gemini Flash Image, Veo 3.1, Replicate Seedream, and Kling are wired into the active runtime through a shared adapter interface. Additional adapters (FAL.ai) exist in code but are not registered in the active runtime yet.
- Animate-still popup that takes a generated image to video without leaving the page.
- PDF image extraction so reference assets from briefing documents do not require manual copy-out.
- Role-managed admin panel and project access control.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| State | TanStack Query (React Query) |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL + Prisma ORM) |
| Auth | Supabase Auth with role-based access |
| Storage | Supabase Storage (CDN) |
| Real-time | Supabase Realtime subscriptions |
| AI | Anthropic Claude (prompt enhancement), Google (Gemini, Vertex), Replicate, Kling |

```
app/
  (auth)/                 # Login, signup
  projects/               # Dashboard and project detail
components/
  projects/               # Project shell and creation
  sessions/               # Session sidebar and filtering
  generation/             # Prompt bar, model picker, gallery
lib/
  supabase/               # Client and server helpers
prisma/
  schema.prisma           # Database schema
```

The internal package name is `prism`. Public surface and the repo are named Vesper; the package name is a leftover from the earliest scaffold.

## Key workflows

- Prompt enhancement: user writes an intent, Claude rewrites with model-specific strategy and any attached reference image, the team picks a model, generation kicks off, results stream into the gallery.
- Animate-still: select an existing image, choose a video model, run generation in a popup, return to the gallery without losing place in the project.
- PDF reference extraction: upload a briefing PDF, pull individual images out, attach them as references to a new prompt without leaving the workspace.

## Setup

Prerequisites: Node.js 18+, Supabase account, API access for the generation providers you plan to use.

```bash
git clone https://github.com/tensalir/Loop-Vesper.git
cd Loop-Vesper
npm install
```

Configure your local project settings with the required database, storage, auth, and provider credentials. See the repo's configuration example for the full list of required fields. For OpenAI GPT Image 2, set the OpenAI API key in `.env.local` and complete [API Organization Verification](https://help.openai.com/en/articles/10910291-api-organization-verification) from the OpenAI developer console.

```bash
npm run prisma:push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Documentation

- [Case note](./docs/case-note.md) — the build story and what Vesper proves.
- [Patterns](./docs/patterns/) — reusable principles surfaced here.
- [Product Requirements](./docs/architecture/PRD.md)
- [Architecture](./docs/architecture/ARCHITECTURE.md)
- [Quick Start](./docs/getting-started/QUICKSTART.md)
- [Gemini Setup](./docs/integrations/GEMINI_SETUP.md)
- [Replicate Setup](./docs/integrations/REPLICATE_SETUP.md)
- [FAL.ai Setup](./docs/integrations/FAL_SETUP.md)
- [Prompt Enhancement](./docs/operations/PROMPT_ENHANCEMENT_FEATURE.md)
- [User Roles](./docs/database/USER_ROLES_SETUP.md)

## Constellation fit

Part of the Loop / Tensalir build constellation. Direct ancestor of Sigil's generation infrastructure and the Loop-Vesper design tokens reused across Babylon, Heimdall, and Mimir. Cross-repo lineage and reusable patterns are encoded in the [thoughtform-repo-intelligence](https://github.com/thoughtform-co/thoughtform-repo-intelligence) Skill and MCP.

## Status and boundaries

- Status: production-ready Loop Earplugs internal tool. Used daily by the Studio team.
- Out of scope: open-source or general-purpose AI generation platform. Vesper is intentionally Loop-shaped.
- Known constraints: prompt enhancement quality depends on the Loop product catalogue staying current; provider availability and pricing across Gemini, Replicate, and Kling shift faster than the adapter layer can absorb without small per-model tweaks; the Loop-Vesper design tokens are reused in Babylon, Heimdall, and Mimir by copy rather than by shared package, which is on the list to formalize.

## Current frontier

More model integrations as they mature, batch operations for campaign-scale generation, and tighter feedback loops between generation output and briefing context. The roadmap is driven by what the team asks for, not by a feature checklist.
