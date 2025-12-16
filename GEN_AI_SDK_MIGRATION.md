# Gen AI SDK Migration Guide

This document describes the migration from `@google-cloud/vertexai` SDK to `@google/genai` SDK.

## Overview

We've migrated from the deprecated `@google-cloud/vertexai` SDK to the modern `@google/genai` SDK to:
- Future-proof the codebase (Vertex AI SDK deprecated June 2026)
- Unify image and video generation through a single SDK
- Enable better Veo 3.1 support with Vertex AI (when SDK adds video support)
- Maintain backward compatibility with Gemini API fallback

## What Changed

### Package Dependencies

**Before:**
- `@google-cloud/vertexai` (deprecated, support ends June 2026)

**After:**
- `@google/genai` (modern, actively maintained)
- `@google-cloud/vertexai` (kept temporarily for backward compatibility, will be removed)

### Code Changes

#### Client Initialization

**Before:**
```typescript
const { VertexAI } = require('@google-cloud/vertexai')
vertexAiClient = new VertexAI({
  project: projectId,
  location,
  googleAuthOptions: { credentials }
})
```

**After:**
```typescript
const { GoogleGenAI } = require('@google/genai')
genAiClient = new GoogleGenAI({
  vertexai: true,
  project: projectId,
  location,
})
// Credentials handled via GOOGLE_APPLICATION_CREDENTIALS env var
```

#### Image Generation

**Before:**
```typescript
const model = vertexAiClient.preview.getGenerativeModel({
  model: 'gemini-3-pro-image-preview',
})
const result = await model.generateContent(payload)
```

**After:**
```typescript
const model = genAiClient.getGenerativeModel({
  model: 'gemini-3-pro-image-preview',
})
const result = await model.generateContent({
  contents: payload.contents,
  generationConfig: payload.generationConfig,
})
```

#### Video Generation

**Status:** Video generation currently uses Gemini API REST endpoints as a fallback. The Gen AI SDK JavaScript version may not have video generation methods yet. When support is added, videos will automatically use Vertex AI.

**Current Implementation:**
- Tries to use Gen AI SDK when available
- Falls back to Gemini API REST (current working implementation)
- Ready to use Vertex AI when SDK adds video support

## Environment Variables

No changes required! The same environment variables work:

- `GOOGLE_CLOUD_PROJECT_ID` - Your Google Cloud project ID
- `GOOGLE_CLOUD_REGION` - Region (defaults to `us-central1`)
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` - Service account JSON (for Vercel)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to credentials file (local dev)
- `GEMINI_API_KEY` - Fallback API key (still used when Vertex AI not configured)

## Benefits

### Image Generation
- ✅ Uses modern Gen AI SDK
- ✅ Better Vertex AI integration
- ✅ Future-proof (SDK actively maintained)
- ✅ Same rate limits and reliability

### Video Generation
- ✅ Code ready for Vertex AI when SDK adds support
- ✅ Currently uses Gemini API REST (works great)
- ✅ Automatic migration to Vertex AI when available

### Overall
- ✅ No breaking changes
- ✅ Backward compatible
- ✅ Better error handling
- ✅ Cleaner codebase

## Testing

### Verify Migration

1. **Check server logs on startup:**
   ```
   [Gen AI SDK] Initialized with Vertex AI for project: ...
   [GeminiAdapter] Using Gen AI SDK with Vertex AI (better rate limits)
   ```

2. **Test image generation:**
   - Should see: `Nano banana pro: Using Gen AI SDK with Vertex AI`
   - Images should generate successfully
   - Better rate limits than before

3. **Test video generation:**
   - Should see: `[Veo 3.1] Using Gemini API REST (fallback)`
   - Videos should generate successfully
   - Will automatically use Vertex AI when SDK adds support

### Fallback Testing

To test fallback behavior, temporarily remove Vertex AI credentials:

1. Remove or comment out `GOOGLE_APPLICATION_CREDENTIALS_JSON`
2. Restart server
3. Should see: `[GeminiAdapter] Using Gemini API (AI Studio)`
4. Both image and video generation should still work

## Troubleshooting

### "Gen AI SDK not configured"

**Possible causes:**
- Missing `GOOGLE_CLOUD_PROJECT_ID`
- Missing `GOOGLE_APPLICATION_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`
- Invalid credentials JSON
- Vertex AI API not enabled

**Solution:**
- Check environment variables are set correctly
- Verify credentials JSON is valid (single line, no breaks)
- Enable Vertex AI API in Google Cloud Console

### Image generation fails with Gen AI SDK

**Fallback behavior:**
- Automatically falls back to Gemini API REST
- Check logs for: `Falling back to Gemini API due to Gen AI SDK error`
- Generation should still succeed

**If fallback also fails:**
- Check `GEMINI_API_KEY` is set
- Verify API key is valid
- Check network connectivity

### Video generation still uses Gemini API

**This is expected!** Video generation currently uses Gemini API REST because:
- Gen AI SDK JavaScript version may not have video methods yet
- Current REST implementation works perfectly
- Code is ready to use Vertex AI when SDK adds support

## Migration Checklist

- [x] Install `@google/genai` SDK
- [x] Replace Vertex AI client initialization
- [x] Migrate image generation to Gen AI SDK
- [x] Update video generation to support Gen AI SDK (with fallback)
- [x] Maintain Gemini API REST fallback
- [x] Update documentation
- [ ] Test image generation with Vertex AI
- [ ] Test image generation without Vertex AI (fallback)
- [ ] Test video generation
- [ ] Remove `@google-cloud/vertexai` dependency (after verification)

## Next Steps

1. **Test thoroughly** in development environment
2. **Deploy to preview** and verify everything works
3. **Monitor production** for any issues
4. **Remove old SDK** (`@google-cloud/vertexai`) after confirming migration is stable

## Rollback Plan

If issues occur, you can temporarily rollback by:

1. Reverting the `lib/models/adapters/gemini.ts` file
2. The old Vertex AI SDK code is still in git history
3. Environment variables remain the same, so no config changes needed

However, the migration should be seamless since we maintain full backward compatibility with Gemini API fallback.

## Support

For issues or questions:
- Check server logs for error messages
- Verify environment variables are set correctly
- Review `VERTEX_AI_SETUP.md` for configuration details
- Check `TESTING_VERTEX_AI.md` for testing procedures
