# Migrating from Gemini API (AI Studio) to Vertex AI

This guide will help you switch from the Gemini API (via AI Studio with rate limits) to Vertex AI (via Google Cloud Console with higher limits).

## Why Switch?

- **Higher Rate Limits**: Vertex AI has significantly higher rate limits compared to AI Studio
- **Better for Production**: Designed for production workloads
- **More Control**: Full Google Cloud Console control and monitoring
- **Billing**: Direct billing through Google Cloud

## Prerequisites

1. Google Cloud Account with billing enabled
2. Google Cloud Project (create one if you don't have it)

## Step 1: Set Up Google Cloud Project

### 1.1 Create/Select Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click "New Project" or select an existing one
4. Note your **Project ID** (not the project name)

### 1.2 Enable Vertex AI API

1. Go to [Vertex AI API page](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
2. Make sure your project is selected
3. Click **"Enable"**
4. Wait for it to enable (may take a minute)

### 1.3 Enable Generative Language API

1. Go to [Generative Language API page](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com)
2. Click **"Enable"**

## Step 2: Set Up Authentication

You have two options for authentication:

### Option A: Service Account (Recommended for Production)

This is the recommended approach for production servers like Vercel.

#### 2.1 Create Service Account

1. Go to [Service Accounts page](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click **"Create Service Account"**
3. Enter a name: `vertex-ai-service` (or your preferred name)
4. Click **"Create and Continue"**

#### 2.2 Grant Permissions

1. In "Grant this service account access to project":
   - Add role: **"Vertex AI User"** (or `roles/aiplatform.user`)
   - Click **"Continue"**
2. Click **"Done"**

#### 2.3 Create and Download Key

1. Click on the service account you just created
2. Go to **"Keys"** tab
3. Click **"Add Key"** → **"Create new key"**
4. Select **"JSON"**
5. Click **"Create"** - this downloads a JSON file
6. **IMPORTANT**: Keep this file secure! It contains credentials.

#### 2.4 Set Environment Variable

**For Local Development:**
Add to `.env.local`:
```env
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
```

**For Vercel (Production):**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add the JSON content as a new variable:
   - **Name**: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
   - **Value**: Paste the entire JSON file content (as a single line, or use Vercel's multi-line support)
3. We'll update the code to handle this format

### Option B: Application Default Credentials (For Local Development)

If you're just testing locally:

```bash
# Install Google Cloud CLI
# Windows: Download from https://cloud.google.com/sdk/docs/install
# Mac: brew install google-cloud-sdk

# Authenticate
gcloud auth application-default login

# Set project
gcloud config set project YOUR_PROJECT_ID
```

This works automatically - no environment variables needed for local dev.

## Step 3: Update Environment Variables

### Remove (or keep for fallback):
```env
GEMINI_API_KEY=your-ai-studio-key  # Optional: keep for fallback
```

### Add:
```env
# Vertex AI Configuration
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_REGION=us-central1  # or us-east1, europe-west1, etc.

# Service Account Credentials (for Vercel)
# Store the entire JSON as a single-line string or use Vercel's JSON env var
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"..."}
```

**Common Regions:**
- `us-central1` (Iowa, USA)
- `us-east1` (South Carolina, USA)
- `us-west1` (Oregon, USA)
- `europe-west1` (Belgium)
- `europe-west4` (Netherlands)
- `asia-southeast1` (Singapore)

## Step 4: Install Required Package

```bash
npm install @google-cloud/vertexai
```

## Step 5: Code Changes

The code has been updated to:
1. Support both Vertex AI (new) and Gemini API (fallback)
2. Automatically use Vertex AI if credentials are configured
3. Fall back to Gemini API if Vertex AI credentials are missing

## Step 6: Test the Migration

1. Make sure your environment variables are set
2. Start your dev server: `npm run dev`
3. Try generating an image with Nano Banana Pro
4. Check the console logs - you should see "Using Vertex AI" instead of "Gemini API"

## Troubleshooting

### Error: "Could not load the default credentials"

**Solution**: Make sure `GOOGLE_APPLICATION_CREDENTIALS` points to the correct JSON file path, or set up Application Default Credentials.

### Error: "Permission denied" or "403 Forbidden"

**Solution**: 
1. Make sure the service account has the "Vertex AI User" role
2. Make sure Vertex AI API is enabled for your project

### Error: "Project not found"

**Solution**: 
1. Double-check your `GOOGLE_CLOUD_PROJECT_ID` matches your actual project ID
2. Make sure you've selected the correct project in Google Cloud Console

### Rate Limits Still Appearing

**Solution**: 
1. Make sure you're using Vertex AI (check logs)
2. Check your Google Cloud quotas: [Quotas Page](https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/quotas)
3. You can request quota increases if needed

## Cost Differences

- **Gemini API (AI Studio)**: Free tier, then pay-as-you-go
- **Vertex AI**: Direct Google Cloud billing, same pricing, but better rate limits

The actual cost per generation is the same, but you get:
- Higher rate limits (avoid rate limit errors)
- Better monitoring in Cloud Console
- Production-grade reliability

## Monitoring Usage

1. Go to [Vertex AI Dashboard](https://console.cloud.google.com/vertex-ai)
2. Click "Monitoring" to see API usage
3. Go to "Billing" → "Reports" for cost breakdown

## Rollback Plan

If you need to rollback:
1. Keep `GEMINI_API_KEY` in your environment variables
2. The code will automatically fall back to Gemini API if Vertex AI credentials are missing
3. Or remove Vertex AI environment variables to force Gemini API usage

