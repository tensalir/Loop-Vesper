---
name: Project brainstorm chatbot
overview: Add a bottom-right Messenger-style brainstorm chatbot on project pages, powered by Claude (Opus 4.5 configurable) via Vercel AI SDK streaming, with multi-thread chat persistence per user+project in Supabase (via Prisma/Postgres).
todos:
  - id: db-chat-schema
    content: Add Prisma models + migration for ProjectChat and ProjectChatMessage tables (scoped by userId + projectId, cascades on delete).
    status: completed
  - id: api-chat-crud
    content: Create API routes to list/create/delete chats and fetch messages, enforcing project access (owner or invited member).
    status: completed
    dependencies:
      - db-chat-schema
  - id: api-chat-stream
    content: Implement AI SDK streaming chat route that loads skills, calls Claude (Opus 4.5 via env), and persists messages onFinish.
    status: completed
    dependencies:
      - api-chat-crud
  - id: ui-widget
    content: Build bottom-right BrainstormChatWidget with chat list/new/delete and AI SDK useChat streaming UI.
    status: completed
    dependencies:
      - api-chat-stream
  - id: mount-project-page
    content: Mount the widget on app/projects/[id]/page.tsx and ensure it resets properly when projectId changes.
    status: completed
    dependencies:
      - ui-widget
  - id: env-docs
    content: Document required env vars (ANTHROPIC_API_KEY, ANTHROPIC_BRAINSTORM_MODEL) and any migration steps.
    status: completed
    dependencies:
      - mount-project-page
---

# Project Brainstorm Chatbot (bottom-right widget)

## Goals

- Add a **new** bottom-right floating chat widget (Messenger-style) on project pages (no changes to the prompt bar).
- Power it with **Claude (Opus 4.5)** for high-level creative brainstorming, while reusing the existing skill system (notably `genai-prompting`).
- Persist chats **per user + per project** in Supabase Postgres (multi-thread: create/switch/delete chats).
- Use **Vercel AI SDK** streaming + `useChat` patterns for a polished chatbot experience.

References:

- Claude Developer Platform docs: [`https://platform.claude.com/docs/en/home`](https://platform.claude.com/docs/en/home)
- Vercel AI SDK: [`https://ai-sdk.dev/docs/introduction`](https://ai-sdk.dev/docs/introduction)
- Vercel Next.js AI Chatbot template patterns: [`https://vercel.com/templates/next.js/nextjs-ai-chatbot`](https://vercel.com/templates/next.js/nextjs-ai-chatbot)

## What we’ll build

### UX

- A **floating button** pinned to the bottom-right of the viewport.
- Clicking opens a **small floating panel** (chat window) above it.
- Inside the panel:
- **Chat selector** (switch between threads)
- **New chat**
- **Delete chat**
- Streaming chat messages + input box
- When navigating to a different project (`/projects/[id]`), the widget switches context and shows that project’s chats (or an empty/new chat if none exist).

### Data model (Supabase Postgres via Prisma)

Add two Prisma models in [`prisma/schema.prisma`](prisma/schema.prisma):

- `ProjectChat`: chat thread metadata (`projectId`, `userId`, `title`, timestamps)
- `ProjectChatMessage`: message rows (`chatId`, `role`, `content`, timestamps)

This keeps chats:

- **isolated by user** (owner/member each has their own threads)
- **scoped by project**
- easy to list/switch/delete

## Backend/API design

We’ll follow existing auth + access patterns from `[app/api/projects/[id]/route.ts](app/api/projects/[id]/route.ts)` (owner OR invited member).

### Routes (new)

- **List + create threads**: `[app/api/projects/[id]/brainstorm/chats/route.ts](app/api/projects/[id]/brainstorm/chats/route.ts)`
- `GET`: list chats for `(projectId, userId)`
- `POST`: create a new chat thread for `(projectId, userId)`
- **Delete thread**: `[app/api/projects/[id]/brainstorm/chats/[chatId]/route.ts](app/api/projects/[id]/brainstorm/chats/[chatId]/route.ts)`
- `DELETE`: delete a chat and cascade-delete its messages
- **Fetch messages for a thread**: `[app/api/projects/[id]/brainstorm/chats/[chatId]/messages/route.ts](app/api/projects/[id]/brainstorm/chats/[chatId]/messages/route.ts)`
- `GET`: return ordered messages (for `initialMessages`)
- **Streaming chat (LLM)**: `[app/api/projects/[id]/brainstorm/chat/route.ts](app/api/projects/[id]/brainstorm/chat/route.ts)`
- `POST`: AI SDK streaming endpoint
- Validates user + project access
- Persists the user message, streams Claude’s response, then persists the assistant message on finish

## LLM prompt strategy (skills)

- Add a dedicated brainstorming skill: [`lib/skills/brainstorming.skill.md`](lib/skills/brainstorming.skill.md)
- In the brainstorming chat route, we’ll load:
- `brainstorming` (new)
- `genai-prompting` (existing)
- Then append a small “override” instruction so the chat can be conversational (the strict “return ONLY the prompt” rule from `genai-prompting` should apply **only** when the user explicitly asks for a final prompt).

## Frontend implementation

### New widget component

- Create [`components/brainstorm/BrainstormChatWidget.tsx`](components/brainstorm/BrainstormChatWidget.tsx)
- Uses `useChat` from the AI SDK UI to stream responses.
- Manages:
- fetching chat list
- selecting active chat
- loading `initialMessages` for that chat
- creating/deleting chats
- Panel styling: fixed, bottom-right, `w-[380px]`-ish, `h-[520px]`-ish, responsive fallback on small screens.

### Mount point

- Render the widget only on project pages by adding it to `[app/projects/[id]/page.tsx](app/projects/[id]/page.tsx)`.

## Dependencies + env

- Add AI SDK deps:
- `ai` (AI SDK core + UI hooks)
- `@ai-sdk/anthropic` (Anthropic provider for AI SDK)
- Env:
- reuse `ANTHROPIC_API_KEY`
- add `ANTHROPIC_BRAINSTORM_MODEL` (set to your preferred **Opus 4.5** model ID)

## Data flow (high level)

```mermaid
sequenceDiagram
  participant User
  participant Widget as BrainstormChatWidget
  participant API as NextRouteHandler
  participant DB as Prisma_SupabasePostgres
  participant Claude as Claude_Opus

  User->>Widget: Open panel + send message
  Widget->>API: POST /api/projects/:id/brainstorm/chat (stream)
  API->>DB: Insert user message
  API->>Claude: streamText(system+messages)
  Claude-->>API: tokens (stream)
  API-->>Widget: streamed tokens
  API->>DB: Insert assistant message (onFinish)
  Widget->>API: GET chats/messages when switching threads
  API->>DB: Query by (projectId,userId,chatId)
  DB-->>API: rows
  API-->>Widget: JSON
```



## Acceptance criteria

- Bottom-right button appears on `/projects/[id]`.
- Panel opens/closes and streams responses.
- Chats are persisted per user+project:
- New project ⇒ no history (auto-creates an empty chat or shows empty state then creates on first message).
- Switching projects switches chat context.
- Multi-thread support:
- create new chat
- switch chats
- delete chat
- No changes to the prompt bar / existing prompt enhancement.