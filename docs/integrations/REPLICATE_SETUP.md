# Replicate Integration Guide

This document explains how the Replicate API integration works in Latentia, including troubleshooting common issues and understanding the implementation details.

## Overview

Replicate is used to access AI models hosted on their platform, including Seedream 4 by ByteDance. The integration supports both text-to-image generation and image-to-image editing.

**Current Models:**
- **Seedream 4** (`replicate-seedream-4`) - Advanced image generation and editing up to 4K resolution

## Authentication

### Environment Variables

Replicate requires an API token to authenticate requests. We support both naming conventions:

```env
# Official Replicate naming (recommended)
REPLICATE_API_TOKEN=r8_your_token_here

# Legacy naming (also supported)
REPLICATE_API_KEY=r8_your_token_here
```

**Note:** The adapter checks for `REPLICATE_API_TOKEN` first, then falls back to `REPLICATE_API_KEY` for backward compatibility.

### Getting Your Token

1. Go to [Replicate Account Settings](https://replicate.com/account/api-tokens)
2. Click "Create token"
3. Copy the token (starts with `r8_`)
4. Add to your `.env.local` file
5. Restart your development server

## How the Integration Works

### The Two-Step Process

The Replicate API requires a version hash to create predictions. To ensure we always use the latest version, we use a two-step process:

#### Step 1: Fetch Model Information

```typescript
const modelResponse = await fetch('https://api.replicate.com/v1/models/bytedance/seedream-4', {
  headers: {
    'Authorization': `Token ${apiKey}`,
  },
})

const modelData = await modelResponse.json()
const versionHash = modelData.latest_version?.id
```

This fetches the current model information and extracts the latest version hash.

#### Step 2: Create Prediction with Version Hash

```typescript
const response = await fetch('https://api.replicate.com/v1/predictions', {
  method: 'POST',
  headers: {
    'Authorization': `Token ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    version: versionHash,  // Dynamic, always latest
    input: {
      prompt: userPrompt,
      aspect_ratio: '16:9',
      // ... other parameters
    },
  }),
})
```

This creates a new prediction using the version hash we fetched in step 1.

### Why This Matters

**The Problem We Solved:**

Initially, the code used a hardcoded version hash like this:

```typescript
// ❌ BAD - Hardcoded version hash
const versionHash = 'a2f89ff3eb81deaa01b2d88ca417a6e3964f1c40c2cd5d6e9fda9b47d4e25ac0'
```

This had two critical issues:

1. **Version Expiration**: When Replicate updates the model, the hash changes. Hardcoded hashes become invalid and cause "Invalid version" errors.
2. **Outdated Models**: You might be using an old version of the model even when a newer one is available.

**Our Solution:**

Fetch the latest version hash dynamically before creating each prediction:

```typescript
// ✅ GOOD - Dynamic version fetch
const modelData = await fetchModelInfo()
const versionHash = modelData.latest_version?.id
```

This ensures:
- We always use the latest model version
- No manual updates needed when models change
- Users get the best results with current model improvements

### API Call Flow

```
User clicks "Generate"
    ↓
[ReplicateAdapter.generateImage()]
    ↓
[1. Fetch model info] → GET /models/bytedance/seedream-4
    ↓
[Extract version hash] → versionHash = modelData.latest_version.id
    ↓
[2. Create prediction] → POST /predictions { version, input }
    ↓
[Get prediction ID] → predictionId
    ↓
[3. Poll for results] → GET /predictions/{predictionId}
    ↓
[Status check loop] → processing → processing → succeeded
    ↓
[Return image URLs] → Display in gallery
```

## Common Issues and Troubleshooting

### Error: "Invalid version or not permitted"

**Cause:** The version hash used doesn't exist or you don't have permission to use it.

**Solution:** This shouldn't happen anymore with dynamic version fetching. If it does, check your API token permissions.

### Error: "version is required" or "Additional property model is not allowed"

**Cause:** You're passing the wrong fields to the `/predictions` endpoint.

**Wrong:**
```typescript
body: JSON.stringify({
  model: 'bytedance/seedream-4',  // ❌ Model identifier not allowed
  input: {...}
})
```

**Correct:**
```typescript
body: JSON.stringify({
  version: 'abc123...',  // ✅ Version hash required
  input: {...}
})
```

**Why:** The `/predictions` endpoint is a low-level API that requires explicit version hashes. The `model` field is only used by Replicate's client library, which handles version resolution internally.

### Error: "REPLICATE_API_TOKEN is not configured"

**Cause:** Your `.env.local` file is missing or the token isn't set.

**Solution:**
1. Check `.env.local` exists in the project root
2. Add: `REPLICATE_API_TOKEN=r8_your_token_here`
3. Restart your dev server
4. Check server logs for "REPLICATE_API_TOKEN is not set" warning

### Timeout Errors

**Cause:** Image generation taking longer than 5 minutes (120 attempts × 5 seconds).

**Solutions:**
- Increase `maxAttempts` if needed
- Some generations (especially complex images) take 10+ minutes
- Check Replicate's status page if widespread

## Supported Parameters

### Seedream 4

**Input Parameters:**
- `prompt` (string, required) - Text description of the image
- `aspect_ratio` (string) - Image aspect ratio:
  - `"1:1"` - Square
  - `"16:9"` - Landscape (wide)
  - `"9:16"` - Portrait (tall)
  - `"4:3"` - Landscape (standard)
  - `"3:4"` - Portrait (standard)
- `size` (string) - Image resolution:
  - `"1K"` - 1024px
  - `"2K"` - 2048px (default)
  - `"4K"` - 4096px
- `image_input` (array) - Reference images for image-to-image editing
- `sequential_image_generation` (string) - Generate multiple related images
- `max_images` (integer) - Number of images to generate (1-15)

**Latentia UI exposes:**
- Aspect ratio selector
- Number of outputs (1 or 4)
- Reference image upload (optional)

## API Reference

### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/models/{owner}/{model_name}` | GET | Get model info and latest version |
| `/predictions` | POST | Create a new prediction |
| `/predictions/{prediction_id}` | GET | Check prediction status |

### Authorization

All requests require the `Authorization` header:

```typescript
headers: {
  'Authorization': `Token ${apiKey}`
}
```

**Note:** It's `Token` not `Bearer` for Replicate's API.

### Request/Response Examples

**Fetch Model Info:**
```typescript
GET https://api.replicate.com/v1/models/bytedance/seedream-4

Response:
{
  "url": "https://replicate.com/bytedance/seedream-4",
  "owner": "bytedance",
  "name": "seedream-4",
  "description": "...",
  "visibility": "public",
  "hardware": "...",
  "latest_version": {
    "id": "689e86da7e7e239de69edfb5d54cd188401104aaee0db6a0c108e9ed371ad19d",
    "created_at": "2025-10-26T...",
    "cog_version": "...",
    // ... more fields
  }
}
```

**Create Prediction:**
```typescript
POST https://api.replicate.com/v1/predictions

Body:
{
  "version": "689e86da7e7e239de69edfb5d54cd188401104aaee0db6a0c108e9ed371ad19d",
  "input": {
    "prompt": "a beautiful sunset",
    "aspect_ratio": "16:9",
    "size": "2K"
  }
}

Response:
{
  "id": "abc123...",
  "status": "starting",
  "input": {...},
  "output": null,
  "created_at": "...",
  // ... more fields
}
```

**Check Prediction Status:**
```typescript
GET https://api.replicate.com/v1/predictions/abc123...

Response (processing):
{
  "id": "abc123...",
  "status": "processing",
  "input": {...},
  "output": null,
  // ...
}

Response (completed):
{
  "id": "abc123...",
  "status": "succeeded",
  "input": {...},
  "output": [
    "https://replicate.delivery/.../output_0.jpg",
    "https://replicate.delivery/.../output_1.jpg"
  ],
  "metrics": {
    "predict_time": 15.23
  }
}
```

## Code Architecture

### File Structure

```
lib/models/
├── base.ts                 # BaseModelAdapter interface
├── registry.ts             # Model registry and factory
└── adapters/
    ├── replicate.ts        # Replicate adapter (this one)
    ├── gemini.ts           # Google Gemini adapter
    └── fal.ts              # FAL.ai adapter
```

### Key Classes

**ReplicateAdapter** - Main adapter class
- Extends `BaseModelAdapter`
- Handles authentication, version resolution, prediction lifecycle
- Location: `lib/models/adapters/replicate.ts`

**ModelConfig** - Configuration interface
- Defines model capabilities, parameters, UI controls
- Location: `lib/models/base.ts`

## Adding New Replicate Models

To add a new model from Replicate:

1. **Get model info:**
   ```bash
   curl https://api.replicate.com/v1/models/owner/model-name \
     -H "Authorization: Token $REPLICATE_API_TOKEN"
   ```

2. **Add config in `replicate.ts`:**
   ```typescript
   export const NEW_MODEL_CONFIG: ModelConfig = {
     id: 'replicate-model-name',
     name: 'Model Display Name',
     provider: 'Provider Name',
     type: 'image', // or 'video'
     description: 'Model description',
     supportedAspectRatios: ['1:1', '16:9', ...],
     // ... more config
   }
   ```

3. **Update adapter to handle the model:**
   - Add version fetch logic for the new model
   - Map UI parameters to API parameters
   - Handle model-specific output formats

4. **Register in `registry.ts`:**
   ```typescript
   this.register(NEW_MODEL_CONFIG, ReplicateAdapter)
   ```

## Best Practices

1. **Always fetch version dynamically** - Don't hardcode version hashes
2. **Poll with reasonable intervals** - 5 seconds is a good default
3. **Set reasonable timeouts** - 10 minutes for complex generations
4. **Handle all status codes** - starting, processing, succeeded, failed, canceled
5. **Log prediction IDs** - Helps with debugging and support
6. **Cache model info** - Can reduce API calls if fetched frequently

## Testing

Test the integration:

```bash
# Check your token is set
echo $REPLICATE_API_TOKEN

# Test the adapter directly
npm run dev

# In the app:
# 1. Select "Seedream 4" model
# 2. Enter a prompt
# 3. Click "Generate"
# 4. Check server logs for API calls
```

## References

- [Replicate API Documentation](https://replicate.com/docs)
- [Seedream 4 Model Page](https://replicate.com/bytedance/seedream-4)
- [Replicate Account & API Tokens](https://replicate.com/account/api-tokens)

## Changelog

### 2025-10-26 - Dynamic Version Resolution

**Problem:** Hardcoded version hashes become invalid when models are updated, causing "Invalid version" errors.

**Solution:** Modified the adapter to fetch the latest version hash dynamically before creating predictions.

**Changes:**
- Added model info fetch: `GET /models/bytedance/seedream-4`
- Extract `latest_version.id` as version hash
- Use dynamic version in prediction creation
- Ensures we always use the latest model version

**Code Changes:**
- `lib/models/adapters/replicate.ts` - Lines 136-169
- Fetch model info before creating prediction
- Use fetched version hash instead of hardcoded value

