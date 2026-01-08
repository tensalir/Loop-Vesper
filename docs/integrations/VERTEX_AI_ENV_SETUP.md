# Vertex AI Environment Variable Setup

## 📋 Quick Copy-Paste Guide

### For `.env.local` (Local Development)

Add these lines to your `.env.local` file:

```env
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project-id",...your-json-credentials...}
```

⚠️ **Important Notes:**
- The `GOOGLE_APPLICATION_CREDENTIALS_JSON` value must be on **one line** (no line breaks)
- Do NOT add quotes around the JSON string in the .env file
- The JSON string starts with `{` and ends with `}`

---

## 🔧 For Vercel (Production)

### Step 1: Go to Vercel Dashboard

1. Navigate to your Vercel project: https://vercel.com/dashboard
2. Select your project (Loop-Vesper)
3. Go to **Settings** → **Environment Variables**

### Step 2: Add Environment Variables

Add these three variables (click "Add New" for each):

**Variable 1:**
- **Key**: `GOOGLE_CLOUD_PROJECT_ID`
- **Value**: `your-project-id`
- **Environments**: ✅ Production, ✅ Preview, ✅ Development

**Variable 2:**
- **Key**: `GOOGLE_CLOUD_REGION`
- **Value**: `us-central1`
- **Environments**: ✅ Production, ✅ Preview, ✅ Development

**Variable 3:**
- **Key**: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- **Value**: (Paste the entire JSON below as a single line - copy from the .env.local example above)
- **Environments**: ✅ Production, ✅ Preview, ✅ Development

📋 **Copy this value for Variable 3:**

Paste the entire contents of your downloaded service account JSON file as a single-line JSON string. The JSON should start with `{"type":"service_account",...` and contain your project ID, private key, and other credentials.

### Step 3: Redeploy

After adding the environment variables, Vercel will automatically redeploy your project, or you can manually trigger a redeploy from the Deployments page.

---

## ✅ Verification

After adding the environment variables, restart your local dev server:

```bash
npm run dev
```

You should see in the console:
```
[Vertex AI] Initialized for project: your-project-id, location: us-central1
[GeminiAdapter] Using Vertex AI (better rate limits)
```

If you see this, Vertex AI is configured correctly! 🎉

---

## 🔒 Security Note

- ⚠️ Never commit the JSON file or `.env.local` to git
- ⚠️ The service account key gives full access to Vertex AI - keep it secure
- ✅ The `.env.local` file should already be in `.gitignore`
- ✅ Vercel environment variables are encrypted and secure

