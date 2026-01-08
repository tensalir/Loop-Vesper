# Vercel Database Connection Setup

## Summary

Prisma + Vercel serverless functions require Supabase's **Transaction Pooler** (port `6543`) with PgBouncer parameters. Session pooler (port `5432`) causes intermittent `Can't reach database server` errors and should be avoided.

## Recommended Configuration (Transaction Pooler)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → **Settings** → **Database**.
2. Scroll to **Connection string** and choose **Transaction pooling**.
3. Copy the URI and replace the password placeholder with your actual DB password.
4. Append the required parameters:
   ```
   ?pgbouncer=true&connection_limit=1
   ```

Example:
```
postgresql://postgres.rcssplhcspjpvwdtwqwl:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

> IMPORTANT: The hostname stays the same; only the port changes to `6543`.

### Update Vercel

1. Vercel Dashboard → Project → **Settings** → **Environment Variables**.
2. Edit `DATABASE_URL` and paste the transaction string above (with your password encoded).
3. Save and **Redeploy** the latest build so functions pick up the change.

### Update Local Development

Create or update `.env.local`:
```env
DATABASE_URL=postgresql://postgres.rcssplhcspjpvwdtwqwl:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

Run `npx prisma generate` afterwards to ensure the client reconnects.

## Fallback: Direct Connection (Last Resort)

If transaction pooling is unavailable in your region or still blocked:

1. Supabase → **Settings** → **Database** → **Connection string** → **Direct connection**.
2. Copy the URI (`db.<project-ref>.supabase.co:5432`) and append:
   ```
   ?pgbouncer=false&connection_limit=1
   ```
3. Replace `DATABASE_URL` in Vercel and `.env.local`.
4. Monitor connection counts closely; direct connections have lower limits.

## Verification Checklist

1. Redeploy on Vercel after changing `DATABASE_URL`.
2. Hit `/api/health` (new endpoint) – it should return `{ status: "ok" }`.
3. Trigger a generation; verify no `Can't reach database server` errors in logs.
4. If failures persist, confirm the URL includes `6543`, `pgbouncer=true`, and `connection_limit=1`.

## Why Transaction Pooler?

- Prisma maintains many idle connections per function invocation.
- Transaction pooling reuses a single connection per invocation, reducing Supabase load.
- Session pooler with Prisma serverless is unstable (see `CRITICAL_DATABASE_FIX.md` for postmortem).

