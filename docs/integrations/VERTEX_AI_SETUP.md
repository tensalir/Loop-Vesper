# Vertex AI Setup Guide

This guide explains how to configure Vertex AI for Google Gemini (Nano Banana Pro and Veo 3.1) to get better rate limits and more reliable access.

## What You Need

You already have:
- ✅ `GOOGLE_CLOUD_PROJECT_ID=gen-lang-client-0963396085`
- ✅ `@google/genai` package installed (Gen AI SDK)

You need to add:
- 🔑 Service account JSON credentials

## Step 1: Enable Vertex AI API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `gen-lang-client-0963396085`
3. Navigate to **APIs & Services** > **Library**
4. Search for "Vertex AI API"
5. Click **Enable**

## Step 2: Create a Service Account

1. In Google Cloud Console, go to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
3. Give it a name (e.g., "vertex-ai-generator")
4. Click **Create and Continue**
5. Grant it the **Vertex AI User** role:
   - Click **Add Another Role**
   - Search for "Vertex AI User"
   - Select it and click **Continue**
6. Click **Done**

## Step 3: Create and Download JSON Key

1. Find your newly created service account in the list
2. Click on it to open details
3. Go to the **Keys** tab
4. Click **Add Key** > **Create new key**
5. Select **JSON** format
6. Click **Create** - this downloads the JSON file

⚠️ **Important**: Keep this JSON file secure! It contains credentials that allow access to your Google Cloud resources.

## Step 4: Configure Environment Variables

### For Local Development (.env.local)

You have two options:

**Option A: Use JSON String (Recommended for Vercel compatibility)**

Copy the entire contents of the downloaded JSON file and paste it as a single-line JSON string in `.env.local`:

```env
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project-id",...your-full-json-credentials-here...}

```

⚠️ **Note**: Remove all line breaks from the JSON when pasting it into the .env file. The entire JSON must be on one line.

**Option B: Use File Path (Local development only)**

1. Save the JSON file somewhere safe (e.g., `~/gcp-credentials/vertex-ai-key.json`)
2. Add to `.env.local`:

```env
GOOGLE_CLOUD_PROJECT_ID=gen-lang-client-0963396085
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/vertex-ai-key.json
```

### For Vercel Production

1. Go to your Vercel project settings
2. Navigate to **Environment Variables**
3. Add these variables:

   - `GOOGLE_CLOUD_PROJECT_ID` = `gen-lang-client-0963396085`
   - `GOOGLE_CLOUD_REGION` = `us-central1` (optional, defaults to us-central1)
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` = (paste the entire JSON file content as a single-line string)

   ⚠️ **Important for Vercel**: Use `GOOGLE_APPLICATION_CREDENTIALS_JSON` (not the file path option) since Vercel doesn't have access to local file system paths.

## Step 5: Verify Configuration

After adding the credentials, restart your development server:

```bash
npm run dev
```

You should see in the console:
```
[Gen AI SDK] Initialized with Vertex AI for project: gen-lang-client-0963396085, location: us-central1
[GeminiAdapter] Using Gen AI SDK with Vertex AI (better rate limits)
```

## What This Enables

- ✅ **Better Rate Limits**: Vertex AI has higher rate limits than the Gemini API
- ✅ **Nano Banana Pro**: Image generation via Gen AI SDK with Vertex AI
- ✅ **Veo 3.1**: Video generation (currently uses Gemini API REST, Vertex AI support coming)
- ✅ **Production Ready**: More reliable for production workloads
- ✅ **Future-Proof**: Uses modern Gen AI SDK (replaces deprecated Vertex AI SDK)

## Fallback Behavior

If Vertex AI credentials are not configured, the system will automatically fall back to the Gemini API (AI Studio) using your `GEMINI_API_KEY`. This ensures your app continues to work even without Vertex AI setup.

## Troubleshooting

**Error: "Vertex AI not configured"**
- Check that `GOOGLE_CLOUD_PROJECT_ID` is set correctly
- Verify `GOOGLE_APPLICATION_CREDENTIALS_JSON` contains valid JSON (no line breaks in .env)
- Make sure the Vertex AI API is enabled in Google Cloud Console

**Error: "Permission denied"**
- Verify the service account has the "Vertex AI User" role
- Check that the JSON key file is valid and not expired

**Rate limit errors**
- Vertex AI has higher limits, but if you're hitting limits, check your quota in Google Cloud Console
- Consider enabling billing if you haven't already (Vertex AI requires billing to be enabled)

