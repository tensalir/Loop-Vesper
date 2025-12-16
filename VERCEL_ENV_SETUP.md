# Vercel Environment Variables Setup

## Required Environment Variables

You **must** configure these in Vercel for authentication to work:

### 1. Supabase Configuration (Required for Authentication)

Go to **Vercel Dashboard → Your Project → Settings → Environment Variables**

Add these variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://rcssplhcspjpvwdtwqwl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**To get these values:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → Use for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → Use for `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Database Connection (Already Configured)

```
DATABASE_URL=postgresql://postgres.rcssplhcspjpvwdtwqwl:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Important**: 
- Replace `YOUR_PASSWORD` with your actual database password (URL-encoded)
- Use **Transaction pooler** (port 6543) for serverless environments like Vercel
- The hostname format is `aws-0-REGION.pooler.supabase.com` (check your Supabase dashboard for exact URL)
- The `?pgbouncer=true` parameter is required for Prisma with Transaction pooler
- `connection_limit=1` is recommended for serverless functions

### 3. AI Model API Keys

```
GEMINI_API_KEY=your-google-api-key
REPLICATE_API_TOKEN=your-replicate-api-token
```

### 4. Background Queue Controls

```
GENERATION_QUEUE_ENABLED=true
GENERATION_QUEUE_BATCH_SIZE=5
GENERATION_QUEUE_LOCK_TIMEOUT_MS=60000
GENERATION_QUEUE_RETRY_DELAY_MS=30000
```

Set `GENERATION_QUEUE_ENABLED=false` locally if you prefer the legacy fire-and-forget HTTP trigger.

### 4. Application URL

```
NEXT_PUBLIC_APP_URL=https://loopvesper.vercel.app
```

### 5. Internal API Secret (Optional but Recommended)

For secure server-to-server API calls (e.g., background processing):

```
INTERNAL_API_SECRET=your-random-secret-string-here
```

**To generate a secure secret:**
```bash
# Generate a random 32-character secret
openssl rand -hex 32
```

**What it does:**
- Allows `/api/generate/process` to be called internally without requiring user authentication
- Improves security by preventing unauthorized access to background processing endpoints
- If not set, the endpoint will still work but will require user authentication for all calls

## How to Check Current Variables in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`loopvesper`)
3. Go to **Settings** → **Environment Variables**
4. Verify all variables above are set

## After Adding Variables

1. **Redeploy** your application:
   - Go to **Deployments** tab
   - Click **...** (three dots) on the latest deployment
   - Click **Redeploy**

2. Wait for deployment to complete (~2 minutes)

3. Test authentication by logging in

## Troubleshooting

### Connection to database server error

**Error**: `Can't reach database server at aws-X-REGION.pooler.supabase.com:5432` or `:6543`

**Cause**: Wrong pooler mode or missing PgBouncer parameter

**Solution**: For Vercel (serverless), use **Transaction pooler** (port 6543) with `pgbouncer=true`:
```
postgresql://postgres.rcssplhcspjpvwdtwqwl:-Z%40nkWLbjajtMfUvMwgTt82dpkhBtkwW6uqis%2A%2Af%40o4@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Important**:
- Must use port `6543` (Transaction pooler) for serverless/Vercel
- Must include `?pgbouncer=true` for Prisma compatibility
- Get exact hostname from Supabase Dashboard → Settings → Database → Connection Pooling → Transaction
- After updating, **redeploy** your application

### "Session not found" or "Unauthorized" errors

**Cause**: Missing `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Solution**: 
1. Check Vercel environment variables have both Supabase variables set
2. Make sure they don't have extra quotes or spaces
3. Redeploy after adding/changing variables

### Projects not loading after login

**Cause**: Database connection issue or missing environment variables

**Solution**:
1. Check Vercel logs for errors
2. Verify `DATABASE_URL` uses **Transaction pooler** (port 6543) with `?pgbouncer=true&connection_limit=1`
3. Ensure no extra spaces in environment variable values (especially `NEXT_PUBLIC_APP_URL`)
4. Verify all Supabase environment variables are set (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
5. After changes, **redeploy** the application

