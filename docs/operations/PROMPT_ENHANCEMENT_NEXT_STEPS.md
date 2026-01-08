# Prompt Enhancement - Next Steps

## ✅ What's Complete

1. ✅ Database schema added to Prisma
2. ✅ API endpoint created (`/api/prompts/enhance`)
3. ✅ System prompt created (`lib/prompts/enhancement-system.md`)
4. ✅ Anthropic SDK installed
5. ✅ ANTHROPIC_API_KEY added to Vercel
6. ✅ Code pushed to GitHub

## 🔄 What's Next (In Order)

### Step 1: Run Database Migration

**Action Required**: Run this SQL in Supabase SQL Editor:

```sql
-- First, get your admin UUID:
SELECT id FROM profiles WHERE role = 'admin' LIMIT 1;

-- Then run the migration from:
-- prisma/migrations/add_prompt_enhancement.sql
```

After running, replace `YOUR_ADMIN_USER_ID` with your actual UUID in the seed data.

---

### Step 2: Add Magic Wand Icon to ChatInput

**File**: `components/generation/ChatInput.tsx`

**Changes Needed**:
1. Add magic wand icon inside the textarea
2. Connect to enhancement API
3. Show enhanced prompts in a modal/sheet
4. Remove Wand2 from Generate button (keep only text)

**Icon Positioning**: Inside the textarea, positioned on the right side

---

### Step 3: Create Enhancement UI Component

**New File**: `components/generation/PromptEnhancementModal.tsx`

**Features**:
- Shows original prompt
- Shows 2-3 enhanced versions
- Copy buttons for each version
- Replace prompt option
- Loading state while enhancing

---

### Step 4: Create Settings Admin Panel

**Update**: `components/settings/AccountSettings.tsx`

**Add New Tab**: "Prompt Enhancement" (only visible to admins)

**Features**:
- List all system prompts
- Edit system prompt
- Create new model-specific prompts
- Toggle active/inactive
- Test system prompt

---

## Quick Start Guide

### For Users (After Implementation)
1. Type a prompt in the input box
2. Click the magic wand icon (✨) inside the input
3. Get 2-3 enhanced prompt suggestions
4. Select and use the enhanced version

### For Admins
1. Go to Settings → Prompt Enhancement tab
2. Edit system prompts for different models
3. Test prompt enhancement
4. Changes apply immediately

---

## Environment Variables Required

Already added to Vercel:
- ✅ `ANTHROPIC_API_KEY`

---

## Database Setup

**Run this SQL** in Supabase (after getting your admin UUID):

```sql
-- 1. Get your admin UUID
SELECT id, display_name, email FROM profiles WHERE role = 'admin' LIMIT 1;

-- 2. Copy the UUID and replace YOUR_ADMIN_USER_ID in:
-- prisma/migrations/add_prompt_enhancement.sql

-- 3. Run the complete SQL from that file
```

---

## Testing the Feature

### Test Prompt Enhancement API

```bash
curl -X POST https://your-domain.vercel.app/api/prompts/enhance \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a cat wearing a hat",
    "modelId": "gemini-nano-banana"
  }'
```

Should return:
```json
{
  "originalPrompt": "a cat wearing a hat",
  "enhancedPrompt": "[Enhanced version...]",
  "enhancementPromptId": "..."
}
```

---

## UI Implementation Details

### Magic Wand Icon

**Location**: Inside textarea, right side
**Color**: Primary accent (mint green in dark mode)
**Behavior**: 
- Click → API call → Show modal with suggestions
- Loading state while enhancing
- Always visible for all users

### Enhancement Modal

**Components**:
- Original prompt (read-only)
- Enhanced versions (2-3) with labels
- Copy button for each
- "Use This Version" button
- Cancel button

### Settings Admin Panel

**New Section** (Admin only):
- Table of system prompts
- Edit/Delete actions
- Create new prompt
- Model-specific configuration

---

## Status

| Task | Status | Priority |
|------|--------|----------|
| Database Migration | Ready | High |
| Magic Wand Icon | TODO | High |
| Enhancement Modal | TODO | High |
| Settings Admin Panel | TODO | Medium |

---

**Next**: Choose which to implement first:
1. Magic Wand Icon + Modal (User-facing)
2. Settings Admin Panel (Admin-facing)

Both can be done in parallel if you want to split the work!

