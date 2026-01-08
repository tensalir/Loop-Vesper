# Prompt Enhancement Feature

## Overview

A smart prompt enhancement system that helps users improve their prompts based on model-specific best practices using Claude Sonnet 4.5.

## Features

### 1. Magic Wand Icon
- Located inside the prompt input box
- Only visible to admins (initially)
- Replaces the magic wand on the Generate button

### 2. Model-Specific Enhancement
- Uses Claude Sonnet 4.5 to enhance prompts
- Applies model-specific best practices
- Respects user's creative intent

### 3. Admin-Managed System Prompts
- System prompts stored in database
- Editable via Settings page (Admin tab)
- Support for multiple prompts per model
- Fallback to universal system prompt

## Setup

### 1. Add Environment Variable

Add to `.env.local` and Vercel:
```
ANTHROPIC_API_KEY=your_claude_api_key_here
```

Get your API key from: https://console.anthropic.com/

### 2. Run Database Migration

```bash
npx prisma migrate dev --name add_prompt_enhancement
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Seed Initial System Prompts

Run this SQL in Supabase to create initial enhancement prompts:

```sql
-- Universal enhancement prompt
INSERT INTO prompt_enhancement_prompts (
  id, name, description, "systemPrompt", "isActive", "modelIds", "createdBy", "updatedBy"
) VALUES (
  gen_random_uuid(),
  'Universal Prompt Enhancer',
  'General prompt enhancement for all models',
  '[Content from lib/prompts/enhancement-system.md]',
  true,
  ARRAY[]::text[], -- Applies to all models if modelIds is empty
  'YOUR_ADMIN_USER_ID',
  'YOUR_ADMIN_USER_ID'
);

-- Nano Banana specific
INSERT INTO prompt_enhancement_prompts (
  id, name, description, "systemPrompt", "isActive", "modelIds", "createdBy", "updatedBy"
) VALUES (
  gen_random_uuid(),
  'Nano Banana Enhancer',
  'Enhanced for Gemini image generation and editing',
  '[Content from lib/prompts/enhancement-system.md with Nano Banana specific additions]',
  true,
  ARRAY['gemini-nano-banana'],
  'YOUR_ADMIN_USER_ID',
  'YOUR_ADMIN_USER_ID'
);

-- Seedream 4 specific
INSERT INTO prompt_enhancement_prompts (
  id, name, description, "systemPrompt", "isActive", "modelIds", "createdBy", "updatedBy"
) VALUES (
  gen_random_uuid(),
  'Seedream 4 Enhancer',
  'Enhanced for Seedream 4 image generation',
  '[Content from lib/prompts/enhancement-system.md with Seedream 4 specific additions]',
  true,
  ARRAY['seedream-4.0'],
  'YOUR_ADMIN_USER_ID',
  'YOUR_ADMIN_USER_ID'
);
```

## Implementation Status

✅ Database schema updated
✅ System prompt created
✅ API endpoint created
✅ Anthropic SDK installed
⏳ UI components (Next)
⏳ Settings page admin panel (Next)
⏳ Magic wand icon (Next)

## Usage

### For Users
1. Type a prompt in the input box
2. Click the magic wand icon
3. Get 2-3 enhanced prompt suggestions
4. Choose and use the enhanced version

### For Admins
1. Navigate to Settings
2. Go to "Prompt Enhancement" tab (to be created)
3. Edit system prompts for different models
4. Changes apply immediately

## Technical Architecture

```
User Input Prompt
      ↓
GET System Prompt for Model
      ↓
Claude Sonnet 4.5 Enhancement
      ↓
Return 2-3 Enhanced Versions
      ↓
User Selects/Copies Enhanced Prompt
```

## Model-Specific Enhancements

### Nano Banana
- Image editing focus (add, remove, modify)
- Reference image handling
- Precise, technical language

### Seedream 4
- Artistic and conceptual emphasis
- Creative composition support
- Mood and atmosphere focus

## API Endpoint

**POST** `/api/prompts/enhance`

**Request:**
```json
{
  "prompt": "a cat wearing a hat",
  "modelId": "gemini-nano-banana",
  "referenceImage": "optional base64"
}
```

**Response:**
```json
{
  "originalPrompt": "a cat wearing a hat",
  "enhancedPrompt": "Enhanced version...",
  "enhancementPromptId": "uuid"
}
```

