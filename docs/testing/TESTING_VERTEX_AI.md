# Testing Vertex AI Configuration

## ✅ Quick Test Checklist

### 1. Check Server Logs on Startup

When you start the dev server (`npm run dev`) or check Vercel function logs, you should see:

```
[Gen AI SDK] Initialized with Vertex AI for project: gen-lang-client-0963396085, location: us-central1
[GeminiAdapter] Using Gen AI SDK with Vertex AI (better rate limits)
```

If you see these messages, Vertex AI is configured correctly! 🎉

If you see instead:
```
[Gen AI SDK] Not configured, will use Gemini API
[GeminiAdapter] Using Gemini API (AI Studio)
```

Then it's falling back to the Gemini API - check your environment variables.

---

## 🖼️ Test Image Generation (Nano Banana Pro)

**This will use Vertex AI** ✅

### Steps:
1. Go to your app (localhost:3000 or your Vercel deployment)
2. Create or open a project
3. Make sure you're in an **Image Session**
4. Select **"Nano banana pro"** as the model
5. Enter a prompt like: `A beautiful sunset over mountains`
6. Click **Generate**

### What to Look For:

**In the browser console or server logs:**
- You should see: `Nano banana pro: Using Gen AI SDK with Vertex AI`
- If it says `Nano banana pro: Using Gemini API (AI Studio)` instead, Vertex AI isn't being used

**Expected behavior:**
- Image should generate successfully
- Generation should be faster/more reliable than before
- Better rate limits (you won't hit quota limits as quickly)

---

## 🎥 Test Video Generation (Veo 3.1)

**Note:** Veo 3.1 currently uses the **Gemini API REST endpoint**, NOT Vertex AI. This is fine and expected! The Gemini API works well for video generation.

### Steps:
1. Go to your app
2. Create or open a project
3. Switch to a **Video Session** (or create one)
4. Select **"Gemini Omni Flash"** as the model (Veo 3.1 until 2026-10-07)
5. Enter a prompt like: `A cat playing with a ball of yarn`
6. Click **Generate**

### What to Look For:

**In the browser console or server logs:**
- You'll see: `[Omni Flash] Starting video generation...`
- It uses the Gemini API Interactions endpoint: `/interactions` with model `gemini-omni-1.1-flash` (Omni is not confirmed on Vertex AI)
- This is normal and expected

**Expected behavior:**
- Video generation request is submitted
- The video comes back in the response (inline under 4 MB); 1080p and 4K come back as a file, polled every 10 seconds
- Video is generated
- Video downloads and displays when ready

---

## 📊 Understanding the Current Setup

### Image Generation (Nano Banana Pro)
- ✅ **Uses Gen AI SDK with Vertex AI** when credentials are configured
- ✅ Better rate limits and reliability
- ✅ Falls back to Gemini API if Vertex AI not available
- ✅ Uses modern `@google/genai` SDK (replaces deprecated `@google-cloud/vertexai`)

### Video Generation (Veo 3.1)
- ℹ️ **Uses Gemini API REST** (fallback)
- ✅ Works perfectly fine with this setup
- 🔄 Will use Vertex AI when Gen AI SDK adds video generation support
- ✅ Code is ready to use Vertex AI when SDK support is available

---

## 🔍 Checking Vercel Logs

To verify Vertex AI is working in production:

1. Go to Vercel Dashboard → Your Project
2. Click **Deployments** → Select the latest deployment
3. Click **Functions** tab
4. Click on any API route (e.g., `/api/generate`)
5. Check the **Logs** section

Look for:
```
[Gen AI SDK] Initialized with Vertex AI for project: gen-lang-client-0963396085, location: us-central1
[GeminiAdapter] Using Gen AI SDK with Vertex AI (better rate limits)
Nano banana pro: Using Gen AI SDK with Vertex AI
```

---

## ❌ Troubleshooting

### If Vertex AI isn't initializing:

1. **Check environment variables are set correctly:**
   - `GOOGLE_CLOUD_PROJECT_ID` should be `gen-lang-client-0963396085`
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` should contain the full JSON (one line)

2. **Check the JSON is valid:**
   - Must be a single line (no line breaks)
   - Must include all fields from the service account JSON
   - Must start with `{` and end with `}`

3. **Check Vertex AI API is enabled:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - APIs & Services → Library
   - Search for "Vertex AI API"
   - Make sure it's **Enabled**

4. **Check service account permissions:**
   - Go to IAM & Admin → Service Accounts
   - Find your service account
   - Verify it has the **"Vertex AI User"** role

---

## 🎯 Success Indicators

You'll know everything is working when:

✅ Server logs show: `[Gen AI SDK] Initialized with Vertex AI...`  
✅ Image generation logs show: `Nano banana pro: Using Gen AI SDK with Vertex AI`  
✅ Images generate successfully  
✅ Videos generate successfully (via Gemini API REST - that's fine!)  
✅ No rate limit errors  

---

## 💡 Current Status

The migration to Gen AI SDK is complete:

- ✅ **Images**: Use Gen AI SDK with Vertex AI (better rate limits)
- ✅ **Videos**: Use Gemini API REST (fallback, works great)
- 🔄 **Future**: When Gen AI SDK adds video generation support, videos will automatically use Vertex AI

The codebase is now future-proof and uses the modern Gen AI SDK instead of the deprecated Vertex AI SDK.

