# VES-002: Fix: Gemini/Vertex AI/Nano Banana Pro Quota & Reference Images

## Status: ✅ RESOLVED

## Problem

Nano Banana Pro (Gemini 3 Pro Image) image generation had multiple issues:

1. **Vertex AI 404 Error:** Model `gemini-3-pro-image-preview` not found via Vertex AI SDK
2. **Gemini API Quota Exhausted:** 429 RESOURCE_EXHAUSTED with `limit: 0`
3. **Resolution Validation Error:** "Resolution exceeds maximum of 1536" when using 2K/4K
4. **Reference images ignored:** When falling back to Replicate, reference images were not being used

## Root Causes

1. **Preview model availability:** `gemini-3-pro-image-preview` not available via Vertex AI SDK
2. **Quota exhaustion:** Free tier Gemini API quota was exceeded
3. **Incorrect resolution validation:** Was checking `request.resolution` against `maxResolution` incorrectly
4. **Wrong Replicate parameter name:** Used `input.image` instead of `input.image_input` for reference images

## Solution

### ✅ Fixed: Three-tier Fallback Chain
```
1. Vertex AI SDK → 404 (model not found)
2. Gemini API (AI Studio) → 429 (quota exhausted)  
3. Replicate (google/nano-banana-pro) → ✅ Works with reference images
```

### ✅ Fixed: Replicate Reference Image Parameter
```typescript
// Before: Wrong parameter name (ignored by API)
input.image = referenceImages[0]

// After: Correct parameter name (same as Seedream 4.5)
input.image_input = referenceImages
```

### ✅ Fixed: Replicate Resolution Parameter
```typescript
// Before: Wrong parameter
input.output_quality = 'highest' | 'high' | 'standard'

// After: Correct parameter with proper values
input.resolution = '4K' | '2K' | '1K'
```

### ✅ Fixed: Resolution Validation
```typescript
// Before: Incorrectly blocked 2K/4K
if (request.resolution > this.config.maxResolution) { ... }

// After: Removed - actual dimensions vary by aspect ratio
// maxResolution updated to 4096 for 4K support
```

### ✅ Fixed: Automatic Fallback to Gemini API
```typescript
if (error?.code === 404 || errorMessage.includes('was not found')) {
  return await this.generateImageGeminiAPI(endpoint, payload)
}
```

## Debugging Process

Used Vercel function logs with `[DEBUG:...]` instrumentation to trace:
- Reference images present in request: ✅ (129403 chars)
- Reference images passed to Replicate: ❌ Wrong parameter name
- Resolution parameter format: ❌ Wrong value format

Key log evidence:
```
[DEBUG:gemini:Replicate:refImages] {"refImagesCount":1,"firstImageLen":129403}
[Replicate Fallback] Using 1 reference image(s)
// But image was ignored because parameter was 'image' not 'image_input'
```

## Files Changed

* `lib/models/adapters/gemini.ts` - Fallback chain, correct Replicate parameters, logging
* `lib/models/base.ts` - Removed incorrect resolution validation
* `app/api/generate/process/route.ts` - Debug logging for reference image flow

## Testing

* Generated with Nano Banana Pro + reference image at 1K, 2K, 4K
* Verified Replicate fallback uses `image_input` parameter
* Confirmed generated images incorporate the reference image

## Branch

`main`

## Commits

* `112edfe` - Add Replicate fallback for Nano Banana Pro when Google APIs hit quota
* `3995b76` - Add debug logging for resolution and reference image issues
* `dee155c` - Fix: Use correct 'image_input' parameter for Nano Banana Pro on Replicate

## Notes

- Vertex AI SDK still returns 404 for `gemini-3-pro-image-preview` (Google hasn't made it available yet)
- Gemini API (AI Studio) has quota limits that reset daily
- Replicate fallback is paid-per-use but works reliably with reference images
