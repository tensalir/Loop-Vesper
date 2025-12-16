# VES-001: Fix: Seedream 4.5 Not Using Reference Images

## Status: ✅ RESOLVED

## Problem

When uploading a reference image for Seedream 4 (now upgraded to 4.5) image generation:

1. The reference image was displayed in the UI correctly
2. The prompt mentioned "this image" or similar references
3. The generated output completely ignored the reference image
4. Seedream was generating text-to-image instead of image-to-image

## Root Causes

1. **Missing `image_input` parameter:** The reference image wasn't being passed to the Replicate API's `image_input` array
2. **Incomplete reference image flow:** Single images (`referenceImage`) weren't being checked alongside array (`referenceImages`)
3. **Missing URL fallback:** `referenceImageUrl` (public URL) wasn't being used as a fallback source
4. **No capability flag:** `multiImageEditing` wasn't set, preventing multiple image uploads
5. **Outdated model:** Using Seedream 4 instead of the newer Seedream 4.5

## Solution

**Upgraded to Seedream 4.5:**

* Changed model path from `bytedance/seedream-4` → `bytedance/seedream-4.5`
* Updated display name to "Seedream 4.5"
* Added `enhance_prompt: true` for better results

**Fixed reference image handling in adapter:**

```typescript
// Build reference images array from all possible sources
let referenceImages: string[] = []

// 1. Check for referenceImages array (multiple images)
if (request.referenceImages?.length > 0) {
  referenceImages = request.referenceImages
}
// 2. Check for single referenceImage (data URL)
else if (referenceImage && typeof referenceImage === 'string') {
  referenceImages = [referenceImage]
}
// 3. Check for referenceImageUrl (public URL)
else if (request.referenceImageUrl) {
  referenceImages = [request.referenceImageUrl]
}

if (referenceImages.length > 0) {
  input.image_input = referenceImages
}
```

**Added capabilities:**

* `'image-2-image': true` - Indicates image-to-image support
* `multiImageEditing: true` - Enables 1-14 reference images (Seedream 4.5 limit)

**Enhanced logging:**

* Added debug logs showing all reference image sources
* Logs confirm when images are passed to API
* Shows image type (data URL vs public URL) and length

## Files Changed

* `lib/models/adapters/replicate.ts` - Upgraded to 4.5, fixed reference image handling, added capabilities
* `app/api/generate/process/route.ts` - Added debug logging for reference image flow

## Testing

* Uploaded single reference image with Seedream 4.5
* Verified logs show `[Seedream-4.5] ✅ Passing 1 reference image(s) to API`
* Generated image correctly incorporates the reference
* Tested with multiple images (multiImageEditing)

## Branch

`main`

## Commits

* `9dcc386` - Upgrade to Seedream 4.5 and fix reference image handling
* `80080d2` - Update Seedream display name to 4.5
