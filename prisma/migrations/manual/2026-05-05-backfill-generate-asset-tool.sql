-- Manual additive data backfill applied via `prisma db execute`.
--
-- Existing headless credentials were issued before `generate_asset` was
-- exposed through MCP, so their allowed_tools arrays still only contain:
-- enhance_prompt, iterate_prompt, list_models.
--
-- This keeps the same token URLs working in Claude while adding the new
-- image-generation tool to active credentials. Revoked credentials stay
-- unchanged.

UPDATE "headless_credentials"
SET "allowed_tools" = ARRAY(
  SELECT DISTINCT unnest("allowed_tools" || ARRAY['generate_asset']::text[])
)
WHERE "revoked_at" IS NULL
  AND NOT ('generate_asset' = ANY("allowed_tools"));
