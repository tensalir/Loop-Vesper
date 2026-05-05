-- Manual additive data backfill applied via `prisma db execute`.
--
-- Existing headless credentials were issued before `list_product_renders`
-- was added to the MCP surface, so their allowed_tools arrays do not
-- include it yet. This adds it to every non-revoked credential so the
-- existing Claude / Cursor connector URLs immediately discover the new
-- tool without having to regenerate the token.
--
-- Idempotent: the WHERE clause skips credentials that already have it.

UPDATE "headless_credentials"
SET "allowed_tools" = ARRAY(
  SELECT DISTINCT unnest("allowed_tools" || ARRAY['list_product_renders']::text[])
)
WHERE "revoked_at" IS NULL
  AND NOT ('list_product_renders' = ANY("allowed_tools"));
