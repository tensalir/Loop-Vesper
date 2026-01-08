# Latentia Setup Guide

This guide will walk you through setting up Latentia from scratch.

## Prerequisites

- Node.js 18+ installed
- npm or pnpm
- A Supabase account (free tier is fine)
- Git (for version control)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project"
3. Create a new organization (if you don't have one)
4. Click "New Project"
5. Fill in the details:
   - **Name**: latentia (or your preferred name)
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free (or Pro if needed)
6. Click "Create new project" and wait for it to finish (takes ~2 minutes)

## Step 3: Get Supabase Credentials

Once your project is ready:

1. Click on the **Settings** icon (gear) in the sidebar
2. Go to **API** section
3. Copy the following:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (under "Project API keys")
   - **service_role** key (under "Project API keys" - keep this secret!)

## Step 4: Configure Environment Variables

1. Copy the example file:
```bash
cp .env.example .env.local
```

2. Open `.env.local` and fill in your Supabase credentials:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Database (from Supabase Settings > Database > Connection String > URI)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# AI Model API Keys
# Google Gemini (for Nano Banana and Veo models)
GOOGLE_API_KEY=your-google-api-key-here

# FAL.ai (for Seedream and other FAL models)
FAL_API_KEY=your-fal-api-key-here
```

**Note**: For the DATABASE_URL, replace `[YOUR-PASSWORD]` with your database password, keeping the square brackets removed.

## Step 5: Set Up Database Schema

Run Prisma migration to create the database tables:

```bash
npm run prisma:push
```

You should see output like:
```
🚀 Your database is now in sync with your Prisma schema.
✔ Generated Prisma Client
```

## Step 6: Configure Supabase Authentication

1. In your Supabase project, go to **Authentication** in the sidebar
2. Go to **Providers**

### Enable Email Authentication

1. Find "Email" in the list
2. Toggle it **ON**
3. Configure:
   - **Enable Email provider**: ON
   - **Confirm email**: ON (recommended)
   - **Secure email change**: ON (recommended)
4. Click "Save"

### Enable Google OAuth (Optional but Recommended)

1. Find "Google" in the list
2. Toggle it **ON**
3. You'll need to create Google OAuth credentials:

#### Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Go to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Choose **Web application**
6. Add authorized redirect URIs:
   ```
   https://your-project.supabase.co/auth/v1/callback
   ```
7. Copy the **Client ID** and **Client Secret**

#### Add to Supabase

1. Back in Supabase, paste:
   - **Client ID**
   - **Client Secret**
2. Click "Save"

### Configure URL Settings

1. In Supabase, go to **Authentication** > **URL Configuration**
2. Add the following:
   - **Site URL**: `http://localhost:3000` (for development)
   - **Redirect URLs**: Add these:
     ```
     http://localhost:3000/auth/callback
     http://localhost:3000
     ```

**Note**: When deploying to production, add your production URLs here too.

## Step 7: Create Profile Trigger (Important!)

When users sign up, we need to automatically create a profile. 

1. Go to **SQL Editor** in Supabase
2. Click **New Query**
3. Paste this SQL:

```sql
-- Create a function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger to run the function on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

4. Click **Run** (or press `Cmd/Ctrl + Enter`)

## Step 8: Set Up Storage Buckets

1. Go to **Storage** in Supabase sidebar
2. Click **Create bucket**
3. Create these buckets:

### Images Bucket
- **Name**: `generated-images`
- **Public bucket**: ON (so images can be viewed)
- Click **Save**

### Videos Bucket
- **Name**: `generated-videos`
- **Public bucket**: ON
- Click **Save**

### Configure Storage Policies

For each bucket, add these policies:

1. Click on the bucket name
2. Go to **Policies** tab
3. Click **New Policy**

**Policy 1: Allow authenticated users to upload**
```sql
-- For INSERT
CREATE POLICY "Users can upload their own content"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'generated-images' AND
  auth.uid()::text = (storage.foldername(name))[1]
);
```

**Policy 2: Allow public read access**
```sql
-- For SELECT
CREATE POLICY "Public can view all content"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'generated-images');
```

Repeat for `generated-videos` bucket, changing the bucket name.

## Step 9: Get API Keys for AI Models (For Later)

When you're ready to integrate AI models, you'll need API keys from:

### Replicate (for Flux and others)
1. Go to [https://replicate.com](https://replicate.com)
2. Sign up/Login
3. Go to Account Settings > API Tokens
4. Copy your token

### Black Forest Labs (for Flux Direct)
1. Go to [https://blackforestlabs.ai](https://blackforestlabs.ai)
2. Sign up for API access
3. Get your API key

### Minimax (for Nano Banana and Video)
1. Go to [https://www.minimaxi.com](https://www.minimaxi.com)
2. Register for API access
3. Get your API key

### Replicate (Seedream 4)

Replicate is used to access AI models like Seedream 4 by ByteDance.

1. Go to [Replicate](https://replicate.com)
2. Sign up for an account
3. Get your API token from [Account Settings](https://replicate.com/account/api-tokens)

Add to your `.env.local`:
```env
REPLICATE_API_TOKEN=r8_your_token_here
```

**Note:** We support both `REPLICATE_API_TOKEN` (recommended) and `REPLICATE_API_KEY` (legacy).

For detailed information about how the Replicate integration works, see [REPLICATE_SETUP.md](./REPLICATE_SETUP.md).

## Step 10: Run the Development Server

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000)

## Step 11: Test the Application

1. **Sign Up**:
   - Go to http://localhost:3000
   - You'll be redirected to `/login`
   - Click "Sign up"
   - Enter email and password
   - Check your email for confirmation link
   - Click the link to confirm

2. **Log In**:
   - Return to http://localhost:3000/login
   - Enter your credentials
   - You should be redirected to `/projects`

3. **Create a Project**:
   - Click "New Project"
   - Enter a name and description
   - Click "Create Project"

4. **Open Project**:
   - Click on your project card
   - You should see the generation interface

5. **Test Generation UI** (Note: Won't actually generate yet):
   - Select a model from the bottom left
   - Enter a prompt
   - Adjust parameters (aspect ratio, resolution)
   - Click "Generate" (this will show the UI but won't generate images until AI APIs are integrated)

## Troubleshooting

### Database Connection Errors

**Error**: `Can't reach database server`

**Solution**: 
1. Check your DATABASE_URL is correct
2. Make sure your database password doesn't have special characters that need encoding
3. If it does, URL-encode the password

### Authentication Errors

**Error**: `Invalid API key`

**Solution**:
1. Double-check your SUPABASE_ANON_KEY in `.env.local`
2. Make sure there are no extra spaces
3. Restart the dev server after changing `.env.local`

### OAuth Redirect Errors

**Error**: `redirect_uri_mismatch`

**Solution**:
1. Make sure you added `http://localhost:3000/auth/callback` to both:
   - Google Cloud Console authorized redirect URIs
   - Supabase Authentication > URL Configuration

### Prisma Errors

**Error**: `Prisma Client could not locate the Query Engine`

**Solution**:
```bash
npm run prisma:generate
```

### Port Already in Use

**Error**: `Port 3000 is already in use`

**Solution**:
```bash
# Kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or run on a different port
PORT=3001 npm run dev
```

## Optional: View Database

To view and edit your database directly:

```bash
npm run prisma:studio
```

This will open Prisma Studio at http://localhost:5555

## Next Steps

Now that your application is running:

1. ✅ Create your first project
2. ✅ Explore the generation interface
3. 🔄 Integrate AI model APIs (see PRD.md for details)
4. 🔄 Implement real-time collaboration
5. 🔄 Add node-based interface
6. 🔄 Deploy to Vercel

## Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment guide (to be created).

## Need Help?

- Check the [PRD.md](./PRD.md) for feature specifications
- Check the [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
- Check the [PROGRESS.md](./PROGRESS.md) for current implementation status

---

**Congratulations!** 🎉 Your Latentia instance is now running!

