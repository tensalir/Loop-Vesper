# VES-002: Issue: Gemini/Vertex AI/Nano Banana Pro Quota & Model Access

## Status: 🟡 OPEN (Partially Mitigated)

## Problem

Nano Banana Pro (Gemini 3 Pro Image) image generation is experiencing multiple issues:

1. **Vertex AI 404 Error:** Model `gemini-3-pro-image-preview` not found via Vertex AI SDK
2. **Gemini API Quota Exhausted:** 429 RESOURCE_EXHAUSTED with `limit: 0`
3. **Resolution Validation Error:** "Resolution exceeds maximum of 1536" when using 2K/4K
4. **Model not in quota dashboard:** Cannot increase quota because model doesn't appear in Vertex AI quota list

## Error Details

### Vertex AI 404 (Primary Path)
```
[VertexAI.ClientError]: got status: 404 Not Found
Publisher Model `projects/.../models/gemini-3-pro-image-preview` was not found
```

### Gemini API 429 (Fallback Path)
```json
{
  "error": {
    "code": 429,
    "message": "You exceeded your current quota...",
    "status": "RESOURCE_EXHAUSTED",
    "details": [{
      "quota": "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
      "limit": 0
    }]
  }
}
```

### Resolution Validation (Fixed)
```
Error: Resolution exceeds maximum of 1536
```

## Root Causes

1. **Preview model availability:** `gemini-3-pro-image-preview` is a preview model that may not be fully available via Vertex AI SDK yet
2. **Quota exhaustion:** Free tier Gemini API quota (250 requests/day) was exceeded
3. **Incorrect validation:** Resolution validation was checking against `maxResolution` config incorrectly
4. **Region limitation:** Model only available in `us-central1`

## Current Mitigations

### ✅ Fixed: Resolution Validation
```typescript
// Before: Incorrectly blocked 2K/4K resolution settings
if (request.resolution > this.config.maxResolution) {
  throw new Error(`Resolution exceeds maximum of ${this.config.maxResolution}`)
}

// After: Removed validation (actual dimensions vary by aspect ratio)
// maxResolution updated to 4096 for 4K support
```

### ✅ Fixed: Automatic Fallback to Gemini API
```typescript
// When Vertex AI returns 404, automatically fall back to Gemini API
if (error?.code === 404 || errorMessage.includes('was not found')) {
  console.error('[Vertex AI] Model not found - falling back to Gemini API')
  return await this.generateImageGeminiAPI(endpoint, payload)
}
```

### ✅ Added: Comprehensive Logging
```
[Vertex AI] Initialization check:
  - Project ID: ✓ Set
  - Region: us-central1
  - Credentials JSON: ✓ Set (2407 chars)
  - Service account: loop-vesper-vertex@...
```

### ✅ Added: Replicate Fallback (Third Fallback)
```typescript
// Fallback chain:
// 1. Vertex AI SDK → 404 or quota error
// 2. Gemini API (AI Studio) → 429 quota exhausted
// 3. Replicate (google/nano-banana-pro) → final fallback

if (isQuotaExhaustedError(error) && REPLICATE_API_KEY) {
  console.log('Trying Replicate fallback (google/nano-banana-pro)...')
  return await this.generateImageReplicate(request)
}
```

The same Nano Banana Pro model is now available via Replicate as a paid-per-use fallback when Google APIs hit quota limits.

## Remaining Issues

### 🔴 Quota Management
- Gemini API (AI Studio) quota is exhausted
- Cannot find model in Vertex AI quota dashboard to request increase
- Preview models may have stricter/hidden quotas

### 🟡 Model Availability
- `gemini-3-pro-image-preview` returns 404 via Vertex AI SDK
- May only be available via Gemini API REST endpoint
- Waiting for Google to make it available via Vertex AI

## Workarounds

### Option 1: Wait for Quota Reset
- Gemini API quota resets daily
- Monitor at: https://ai.google.dev/usage?tab=rate-limit

### Option 2: Use Alternative Models
- Seedream 4.5 (Replicate) - working, supports reference images
- Reve (Replicate) - text-to-image only

### Option 3: Request Quota Increase
1. Go to: https://console.cloud.google.com/iam-admin/quotas
2. Filter by: Vertex AI API, us-central1
3. Find relevant generative AI quotas
4. Request increase

### Option 4: Billing/Paid Tier
- Enable billing on Google Cloud project
- May unlock higher or paid quotas

## Files Changed

* `lib/models/adapters/gemini.ts` - Fallback logic, logging, resolution fix
* `lib/models/base.ts` - Removed incorrect resolution validation

## Environment Variables Required

```env
GOOGLE_CLOUD_PROJECT_ID=gen-lang-client-0963396085
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
GEMINI_API_KEY=your-api-key
```

## Branch

`main`

## Related Commits

* `7bf6530` - Fix Nano Banana Pro resolution validation and Seedream-4 reference image handling
* `f28aff4` - Fix TypeScript error: declare errorMessage before use

## Next Steps

- [ ] Monitor if Google makes `gemini-3-pro-image-preview` available via Vertex AI SDK
- [ ] Consider upgrading to paid tier for higher quotas
- [ ] Explore other Google image generation models when available
- [ ] Add user-facing error message when quota is exhausted
