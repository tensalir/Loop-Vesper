# Pre-Refactoring Configuration Snapshot

_Last updated: 2025-11-23T00:00:00Z_

This document captures the baseline configuration prior to the refactor so we can quickly compare future changes or roll back if needed.

## Prisma Schema

| File | SHA256 |
|------|--------|
| `prisma/schema.prisma` | `7EAF988D3B52808E08A1B54C08D24C1323EA1FA69FA84D5A3F8EB8D3D9789D39` |

> Recompute with `Get-FileHash prisma\schema.prisma -Algorithm SHA256` (PowerShell) or `shasum -a 256 prisma/schema.prisma` (Unix) whenever the schema changes.

## Environment Variables

Use `vercel env pull .env.pre-refactor` to materialize the server copy locally. The table below mirrors the current values (secrets redacted).

| Key | Value Snapshot | Notes |
|-----|----------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rcssplhcspjpvwdtwqwl.supabase.co` | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `*** redacted ***` | Copy from Supabase → Settings → API |
| `DATABASE_URL` | `postgresql://postgres.rcssplhcspjpvwdtwqwl:***@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1` | Transaction pooler w/ PgBouncer |
| `GEMINI_API_KEY` | `*** redacted ***` | Google Generative Language API |
| `REPLICATE_API_TOKEN` | `*** redacted ***` | Replicate account token |
| `NEXT_PUBLIC_APP_URL` | `https://loopvesper.vercel.app` | Used for deep links and Supabase redirects |

Additional keys documented in `VERCEL_ENV_SETUP.md` remain unchanged. Keep the authoritative secret values in 1Password + Vercel; only the structure is mirrored here.

## Verification Checklist

- [x] `vercel env ls` reviewed on 2025-11-23.
- [x] Prisma schema hash captured.
- [ ] Re-run this snapshot after major database or env changes.

