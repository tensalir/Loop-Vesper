# 🚨 CRITICAL: Database Connection Fix

## Issue

Your app is showing this error:
```
Can't reach database server at aws-1-eu-west-1.pooler.supabase.com:5432
```

This means the `DATABASE_URL` environment variable is using the **pooler** connection string, which can have connectivity issues with Prisma from serverless functions.

---

## Immediate Fix Required

### Step 1: Get the Correct Connection String

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Navigate to: **Settings** → **Database**
4. Scroll down to **Connection string**
5. Select **Transaction mode** (not Session pooler!)
6. Copy the connection string

It should look like:
```
postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**Key difference**: Port `6543` (transaction mode) instead of `5432` (session pooler)

### Step 2: Update Vercel Environment Variables

1. Go to your Vercel project dashboard
2. Navigate to: **Settings** → **Environment Variables**
3. Find `DATABASE_URL`
4. Click **Edit**
5. Replace with the **Transaction mode** connection string from Step 1
6. Important: Add this parameter at the end if not present:
   ```
   &connection_limit=1
   ```
7. Click **Save**

### Step 3: Redeploy

After updating the environment variable:
1. Go to **Deployments** tab
2. Click the **"..."** menu on the latest deployment
3. Click **Redeploy**

---

## Why This Happened

Prisma Client has issues with PgBouncer in **Session pooler mode** (port 5432) when used in serverless environments. The correct approach is:

- ✅ **Transaction mode** (port 6543) - Works with Prisma in serverless
- ❌ **Session pooler mode** (port 5432) - Causes connection errors

---

## Verification

After redeploying, check:

1. Open your app
2. Load a session
3. Check browser console - should see generations loading
4. No more Prisma connection errors in Vercel logs

---

## Alternative: Direct Connection (If Transaction Mode Doesn't Work)

If transaction mode still has issues, use the **direct connection**:

1. In Supabase Dashboard → Database → Connection string
2. Select **Direct connection** (not pooled)
3. It will look like:
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
4. Add this to the end:
   ```
   ?pgbouncer=false&connection_limit=1
   ```
5. Update in Vercel and redeploy

**Note**: Direct connection is more reliable but has lower connection limits.

---

## Database Connection String Comparison

| Mode | Port | Works with Prisma Serverless? | When to Use |
|------|------|------------------------------|-------------|
| Session Pooler | 5432 | ❌ No | Traditional servers |
| Transaction Pooler | 6543 | ✅ Yes | **Serverless (Vercel)** |
| Direct | 5432 | ✅ Yes | Low-traffic serverless |

---

## Check Your Current Connection String

Your error shows:
```
aws-1-eu-west-1.pooler.supabase.com:5432
```

This is **Session Pooler mode** (port 5432), which is causing the issue.

You need to change to either:
- Transaction mode: `aws-1-eu-west-1.pooler.supabase.com:6543`
- Or Direct: `db.[PROJECT-REF].supabase.co:5432`

---

## Additional Notes

### If using Prisma Accelerate
If you're on Prisma's paid plan, you can use Prisma Accelerate which handles connection pooling:
```
DATABASE_URL="prisma://accelerate.prisma-data.net/?api_key=..."
```

### Connection String Format
Always include these parameters for serverless:
```
?pgbouncer=true&connection_limit=1
```

Or for direct connections:
```
?pgbouncer=false&connection_limit=1
```

---

## Quick Fix Summary

1. ✅ Change `DATABASE_URL` to Transaction mode (port 6543)
2. ✅ Add `&connection_limit=1` to connection string
3. ✅ Redeploy on Vercel
4. ✅ Test that database queries work

This should fix the database connection errors immediately!

