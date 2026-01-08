# VES-003: Nano Banana Pro Reference Images Not Working (Wrong Parameter Name)

## Status: ✅ RESOLVED

## Problem

When using Nano Banana Pro (via Replicate fallback) with reference images, the reference images were being **completely ignored**. Users would upload reference images expecting image-to-image generation, but the model would only do text-to-image generation.

## Root Cause

In `lib/models/adapters/gemini.ts`, the Replicate fallback for Nano Banana Pro was using the **wrong parameter name**:

```typescript
// ❌ WRONG - This parameter was being silently ignored by the API
input.image_urls = referenceImages
```

The correct parameter name (as documented in VES-002 and used by Seedream 4.5) is `image_input`:

```typescript
// ✅ CORRECT - Same parameter name as Seedream 4.5
input.image_input = referenceImages
```

## Why This Happened

1. VES-002 documented the fix as changing `input.image` to `input.image_input`
2. However, the actual code in `gemini.ts` was using `image_urls` (not `image`)
3. The parameter `image_urls` doesn't exist in the Replicate API, so it was silently ignored
4. The API would accept the request but generate a text-to-image result instead

## Impact

- All Nano Banana Pro generations with reference images were effectively text-to-image only
- Users would see their uploaded reference images in the UI but they had no effect
- This created a frustrating UX where the feature appeared to work but didn't

## Solution

Changed `image_urls` to `image_input` in `lib/models/adapters/gemini.ts`:

```typescript
// Add reference images if provided
// Nano Banana Pro uses 'image_input' parameter (array, up to 14 images) - same as Seedream 4.5
// NOTE: Previously used 'image_urls' which was WRONG and caused reference images to be ignored!
const referenceImages = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
if (referenceImages.length > 0) {
  input.image_input = referenceImages
  console.log(`[Replicate Fallback] ✅ Using ${referenceImages.length} reference image(s) via image_input`)
}
```

## Prevention

To prevent similar issues in the future:

1. **Always test with reference images** when implementing image generation features
2. **Check API documentation** for the exact parameter names - Replicate APIs can have different param names
3. **Add explicit logging** when reference images ARE and ARE NOT being used
4. **Compare with working implementations** - Seedream 4.5 in `replicate.ts` already had the correct param

## Related Issues

- VES-002: Gemini/Vertex AI/Nano Banana Pro Quota & Reference Images (partial fix)

## Files Changed

- `lib/models/adapters/gemini.ts` - Fixed `image_urls` → `image_input` in `generateImageReplicate()`

