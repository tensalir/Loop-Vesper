# ⚠️ IMPORTANT: Environment Variable Update Required

## Action Required Before Deployment

The performance optimizations require **one new environment variable** to be added.

### Required Environment Variable

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### How to Get the Service Role Key

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Navigate to: **Settings** → **API**
4. Scroll down to **Project API keys**
5. Copy the **`service_role`** key (⚠️ **NOT** the `anon` key!)

### Where to Add It

#### For Local Development

Add to your `.env.local` file:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### For Vercel Deployment

1. Go to your Vercel project dashboard
2. Navigate to: **Settings** → **Environment Variables**
3. Click **Add New**
4. Set:
   - **Name**: `SUPABASE_SERVICE_ROLE_KEY`
   - **Value**: Your service role key
   - **Environments**: Select all (Production, Preview, Development)
5. Click **Save**
6. **Redeploy your app** (important!)

### Why Is This Needed?

The service role key is used by the background processor to upload generated images/videos to Supabase Storage. Without it:
- Images will fail to upload
- Generations will still work but files won't be stored properly
- You'll see errors in Vercel logs

### Security Note

⚠️ **The service role key bypasses Row Level Security (RLS)**

- Never expose it in frontend code
- Only use it in server-side code (API routes)
- Never commit it to git
- All our usage is server-side only in:
  - `lib/supabase/storage.ts`
  - `app/api/generate/process/route.ts`

### Verification

After adding the key and redeploying, test by:

1. Generate an image
2. Wait for it to complete
3. Check Supabase Storage dashboard
4. You should see files in `generated-images/{userId}/...`

If files aren't appearing, check Vercel function logs for upload errors.

---

## Optional: Prisma Client Regeneration

If you see TypeScript errors about Prisma models, run:

```bash
npx prisma generate
```

Then commit and push the changes.

---

## Optional: Enable Supabase Realtime

For instant updates (otherwise polling works fine):

1. Go to Supabase Dashboard → **Database** → **Replication**
2. Find the `generations` table
3. Toggle replication **ON**
4. Find the `outputs` table
5. Toggle replication **ON**
6. Click **Save**

---

That's it! Add the service role key, redeploy, and everything should work perfectly. 🚀

