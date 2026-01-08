# Brainstorm Chatbot Setup

The brainstorm chatbot is a bottom-right floating widget on project pages that helps users explore creative ideas for their AI-generated images and videos. It's powered by Claude via the Vercel AI SDK with streaming responses.

## Features

- **Per-project, per-user chat threads**: Each user has their own chat history isolated by project
- **Multi-thread support**: Create, switch between, and delete chat threads
- **Streaming responses**: Real-time streaming of Claude's responses
- **Persistent history**: All conversations are stored in Supabase/Postgres
- **Creative brainstorming skill**: Specialized system prompts for creative ideation

## Environment Variables

Add these to your `.env` file:

```bash
# Required: Anthropic API key (already used for prompt enhancement)
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Override the default model for brainstorming
# Default is claude-sonnet-4-20250514 if not set
# For best brainstorming results, use Opus 4.5:
ANTHROPIC_BRAINSTORM_MODEL=claude-opus-4-20250514
```

## Database Migration

Run the Prisma migration to create the chat tables:

```bash
# Option 1: Generate and apply migration
npx prisma migrate dev --name add_project_chats

# Option 2: If you already have the migration file, just push
npx prisma db push

# Regenerate Prisma client
npx prisma generate
```

### New Tables Created

1. **`project_chats`**: Chat thread metadata
   - `id`: UUID primary key
   - `project_id`: FK to projects (cascades on delete)
   - `user_id`: FK to profiles (cascades on delete)
   - `title`: Thread title (auto-generated from first message)
   - `created_at`, `updated_at`: Timestamps

2. **`project_chat_messages`**: Individual messages
   - `id`: UUID primary key
   - `chat_id`: FK to project_chats (cascades on delete)
   - `role`: 'user' or 'assistant'
   - `content`: Message text
   - `created_at`: Timestamp

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/projects/[id]/brainstorm/chats` | GET | List user's chats for this project |
| `/api/projects/[id]/brainstorm/chats` | POST | Create a new chat thread |
| `/api/projects/[id]/brainstorm/chats/[chatId]` | PATCH | Rename a chat thread |
| `/api/projects/[id]/brainstorm/chats/[chatId]` | DELETE | Delete a chat and all messages |
| `/api/projects/[id]/brainstorm/chats/[chatId]/messages` | GET | Get messages for a chat |
| `/api/projects/[id]/brainstorm/chat` | POST | Streaming chat endpoint (AI SDK) |

## Skills System

The chatbot uses two skills combined:

1. **`brainstorming`** (`lib/skills/brainstorming.skill.md`): Creative ideation, style exploration, artistic references
2. **`genai-prompting`** (`lib/skills/genai-prompting.skill.md`): Prompt engineering expertise when users ask for final prompts

## Usage

1. Navigate to any project page (`/projects/[id]`)
2. Click the sparkle icon in the bottom-right corner
3. Type your creative ideas and questions
4. The assistant will help you explore directions, suggest variations, and provide prompts when asked

## Troubleshooting

### Chat not loading
- Ensure `ANTHROPIC_API_KEY` is set in your environment
- Check that the database migration has been applied
- Verify the user has access to the project (owner or invited member)

### Streaming not working
- The `ai` and `@ai-sdk/anthropic` packages must be installed
- Check browser console for CORS or network errors
- Verify the API route is accessible

### Messages not persisting
- Check Prisma logs for database errors
- Ensure the `project_chats` and `project_chat_messages` tables exist
- Verify foreign key constraints are satisfied

