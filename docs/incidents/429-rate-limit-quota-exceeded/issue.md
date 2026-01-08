# 429 Rate Limit / Quota Exceeded Error

## Summary

Image generation requests are failing with `429 RESOURCE_EXHAUSTED` errors from both Google Vertex AI and Gemini API (AI Studio). The system attempts to use Vertex AI first (for better rate limits), but when that fails due to quota exhaustion, it falls back to Gemini API, which also returns a 429 error indicating zero quota.

## Status

🔴 **Active** - Blocking image generation functionality

## Environment

- **Platform**: Vercel (Production)
- **Model**: `gemini-3-pro-image-preview` (Nano banana pro)
- **API Provider**: Google Vertex AI (primary) → Gemini API (fallback)
- **Region**: `global` (configured via `GOOGLE_CLOUD_REGION`)

## Error Details

### Vertex AI Error
```
Gen AI SDK error: [ApiError]: {
  "error": {
    "code": 429,
    "message": "Resource exhausted. Please try again later. Please refer to https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429 for more details.",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

### Gemini API Fallback Error
```
Gemini API error: {
  "error": {
    "code": 429,
    "message": "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/usage?tab=rate-limit.",
    "status": "RESOURCE_EXHAUSTED",
    "details": [
      {
        "quota": "generativelanguage.googleapis.com/generate_requests_per_model_per_day",
        "limit": 0
      }
    ]
  }
}
```

**Key Finding**: The Gemini API quota limit is explicitly set to `0`, indicating no quota has been allocated for the API key.

## Steps to Reproduce

1. Navigate to the Loop Vesper application on Vercel
2. Select "Nano banana pro" as the model
3. Upload 2 reference images (earplugs in this case)
4. Enter a prompt (e.g., "Using the provided image, place both earplugs floating weightlessly among soft, fluffy white clouds...")
5. Click "Generate"
6. Observe the generation progress cards showing "95% Finalizing output"
7. Check Vercel logs - generation fails with 429 errors

## Expected Behavior

- Image generation should complete successfully using Vertex AI (which has better rate limits)
- If Vertex AI fails, the fallback to Gemini API should work (if quota is available)
- Users should receive generated images

## Actual Behavior

- Vertex AI returns 429 "Resource exhausted" error
- System falls back to Gemini API
- Gemini API also returns 429 with quota limit of 0
- Generation fails with "All image generations failed"
- User sees failed generation status in UI

## Request Payload Structure

The payload structure is correct (includes `role: 'user'` in contents array):

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "<redacted:551>"
        },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "<redacted:49444>"
          }
        },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "<redacted:41816>"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["image"],
    "temperature": 1,
    "imageConfig": {
      "aspectRatio": "16:9"
    }
  }
}
```

## Root Cause Analysis

### Hypothesis 1: Vertex AI Quota Exhausted
**Status**: ✅ **CONFIRMED**
- Vertex AI is returning 429 errors indicating resource exhaustion
- This could be due to:
  - Daily/monthly quota limits reached
  - Rate limits exceeded (requests per minute/second)
  - Billing/quota not properly configured in Google Cloud Console

### Hypothesis 2: Gemini API Quota Not Allocated
**Status**: ✅ **CONFIRMED**
- Gemini API explicitly shows `limit: 0` for `generate_requests_per_model_per_day`
- This indicates the API key has no quota allocated
- The API key may be in a free tier with zero quota, or quota needs to be requested/enabled

### Hypothesis 3: Fallback Logic Issue
**Status**: ⚠️ **PARTIALLY CONFIRMED**
- The fallback logic works correctly (attempts Vertex AI, then falls back to Gemini API)
- However, both paths are failing, so the fallback provides no benefit
- The system should potentially implement retry logic with exponential backoff for 429 errors

## Impact

- **User Experience**: All image generations are failing
- **Business Impact**: Core functionality is blocked
- **Error Rate**: 100% failure rate for image generations

## Possible Solutions

### Solution 1: Request/Increase Vertex AI Quota
1. Navigate to Google Cloud Console → Vertex AI → Quotas
2. Check current quota limits for `gemini-3-pro-image-preview` model
3. Request quota increase if needed
4. Verify billing is enabled and active

**Priority**: 🔴 **HIGH** - This is the primary path and should be fixed first

### Solution 2: Enable Gemini API Quota
1. Navigate to Google AI Studio → Settings → API Keys
2. Check quota allocation for the API key
3. Request quota increase or enable billing
4. Verify the API key has access to `gemini-3-pro-image-preview`

**Priority**: 🟡 **MEDIUM** - This is the fallback path, but should still be configured

### Solution 3: Implement Retry Logic with Exponential Backoff
- Add retry logic for 429 errors with exponential backoff
- Retry up to 3-5 times with increasing delays (e.g., 1s, 2s, 4s, 8s)
- Only retry on 429 errors, not on other error types

**Priority**: 🟢 **LOW** - Nice to have, but doesn't solve the root cause

### Solution 4: Add Rate Limiting on Client Side
- Implement client-side rate limiting to prevent overwhelming the APIs
- Show user-friendly messages when rate limits are hit
- Queue requests and process them gradually

**Priority**: 🟢 **LOW** - Preventive measure, but doesn't solve current issue

## Configuration Required

### Environment Variables (Already Set)
- ✅ `GOOGLE_CLOUD_PROJECT_ID` - Set
- ✅ `GOOGLE_CLOUD_REGION=global` - Set
- ✅ `GOOGLE_APPLICATION_CREDENTIALS_JSON` - Set
- ✅ `INTERNAL_API_SECRET` - Set
- ✅ `GEMINI_API_KEY` - Set (but has zero quota)

### Google Cloud Console Actions Needed
1. **Vertex AI Quota**:
   - Navigate to: https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/quotas
   - Check quota for "Generative AI API requests per day"
   - Request increase if needed

2. **Gemini API Quota**:
   - Navigate to: https://ai.google.dev/usage?tab=rate-limit
   - Check current quota allocation
   - Request quota increase or enable billing

## Related Issues

- Previous issue: `INVALID_ARGUMENT: Please use a valid role: user, model` - **RESOLVED** (added `role: 'user'` to payload)
- Previous issue: `401 Unauthorized` for `/api/generate/process` - **RESOLVED** (added `INTERNAL_API_SECRET` header)

## Timeline

- **2025-12-16 15:00**: First observed 429 errors from Vertex AI
- **2025-12-16 15:01**: Confirmed fallback to Gemini API also returns 429 with zero quota

## Next Steps

1. ✅ **IMMEDIATE**: Check Google Cloud Console for Vertex AI quota status
2. ✅ **IMMEDIATE**: Check Google AI Studio for Gemini API quota allocation
3. ⏳ **SHORT TERM**: Request quota increases for both APIs
4. ⏳ **SHORT TERM**: Verify billing is enabled and active
5. ⏳ **MEDIUM TERM**: Implement retry logic with exponential backoff for 429 errors
6. ⏳ **MEDIUM TERM**: Add monitoring/alerting for quota exhaustion

## References

- [Vertex AI Error Code 429 Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429)
- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Google AI Studio Usage Dashboard](https://ai.google.dev/usage?tab=rate-limit)

## Files Included

This issue folder contains copies of the relevant files at the time of reporting:

- `lib/models/adapters/gemini.ts` - Gemini adapter with Vertex AI and Gemini API integration
- `app/api/generate/process/route.ts` - Background processor endpoint
- `app/api/generate/route.ts` - Main generation endpoint
