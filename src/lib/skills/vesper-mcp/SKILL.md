---
name: vesper-mcp
description: Connect Claude, Cursor, or Codex to Vesper for Loop-aware prompt craft, product renders, and image generation via MCP. Use when setting up the Vesper MCP connector, generating Loop product imagery, enhancing prompts with the Gen-AI skill, or polling async Vesper jobs.
---

# Vesper MCP

Vesper is Loop's image and video workshop exposed as a remote MCP server.

## Setup

1. Sign in at `/headless` and generate your MCP URL (`/api/mcp/vsp_live_...`) or bearer token.
2. Add to your MCP client:

```json
{
  "mcpServers": {
    "vesper": {
      "url": "https://loopvesper-one.vercel.app/api/mcp/vsp_live_<prefix>_<secret>",
      "timeout": 120000
    }
  }
}
```

For Cursor with header auth:

```json
{
  "mcpServers": {
    "vesper": {
      "url": "https://loopvesper-one.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer vsp_live_..." },
      "timeout": 120000
    }
  }
}
```

3. Optional slash prompts: `/vesper:generate`, `/vesper:enhance`, `/vesper:iterate`

## Workflow

1. `list_models` or read `vesper://models`
2. `enhance_prompt` before first generation
3. `list_product_renders` when the brief needs real Loop product shots
4. `generate_asset` — images return inline by default
5. Pass a prior Storage URL as `referenceImage` for iteration
6. If the client times out (~60s), use `async: true` and poll `get_generation_status`

## Hard rules

- Pass `allowFallback: false` when you must not silently route to Replicate
- Pass `inlineBase64: false` in Cowork artifact flows (large payloads)
- Video: use `generate_video` (async by default) + `get_generation_status`
