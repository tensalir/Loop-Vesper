/**
 * End-to-end smoke test for the token-in-URL MCP endpoint.
 *
 *   1. Mints a temporary `vsp_live_*` credential directly in the
 *      database, scoped to a chosen owner (defaults to the first admin
 *      profile we can find), with all 4 MCP tools and full model access.
 *   2. Hits the chosen MCP base URL with the standard JSON-RPC 2.0
 *      handshake: initialize -> notifications/initialized -> tools/list
 *      -> tools/call(list_models). list_models reads the local registry
 *      so we get a real round-trip without paying any provider cost.
 *   3. Optionally exercises tools/call(generate_asset) when --with-generate
 *      is passed. Hits the cheapest, fastest image model and asserts an
 *      image content block comes back. Costs ~$0.04 per run.
 *   4. Revokes the test credential whether the test passes or fails so
 *      the database is left clean.
 *
 * Run with:
 *   node scripts/test-mcp-url.mjs
 *   node scripts/test-mcp-url.mjs --base https://loopvesper-one.vercel.app
 *   node scripts/test-mcp-url.mjs --base http://localhost:3000
 *   node scripts/test-mcp-url.mjs --with-generate              # adds Step 6
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'

// Parse a small flag set: --base <url>, --with-generate (boolean flag).
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

const BASE = (typeof args.base === 'string' ? args.base : '').trim() || 'https://loopvesper-one.vercel.app'
const WITH_GENERATE = Boolean(args['with-generate'])
const TEST_NAME = `mcp-url-smoke-test-${Date.now()}`

const prisma = new PrismaClient()

function issueRawToken() {
  const prefixRandom = crypto.randomBytes(8).toString('hex') // 16 hex chars
  const secretRandom = crypto.randomBytes(24).toString('hex') // 48 hex chars
  const tokenPrefix = `vsp_live_${prefixRandom}`
  const rawToken = `${tokenPrefix}_${secretRandom}`
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  return { rawToken, tokenPrefix, tokenHash }
}

async function rpc(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* leave parsed null */
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body: parsed, raw: text }
}

function ok(label) {
  console.log(`  PASS  ${label}`)
}

function fail(label, detail) {
  console.error(`  FAIL  ${label}`)
  if (detail !== undefined) console.error('         ', detail)
  process.exitCode = 1
}

async function main() {
  console.log(`MCP token-in-URL smoke test`)
  console.log(`  Base URL : ${BASE}`)

  // 1. Find an owner to attach the test credential to. Prefer an active
  // admin since admins always pass any per-owner gating; fall back to
  // any active profile.
  const owner =
    (await prisma.profile.findFirst({
      where: { role: 'admin', deletedAt: null, pausedAt: null },
      select: { id: true, displayName: true, username: true, role: true },
    })) ||
    (await prisma.profile.findFirst({
      where: { deletedAt: null, pausedAt: null },
      select: { id: true, displayName: true, username: true, role: true },
    }))

  if (!owner) {
    fail('Find an active profile to own the test credential')
    await prisma.$disconnect()
    return
  }
  console.log(
    `  Owner    : ${owner.displayName || owner.username || owner.id} (${owner.role})`,
  )

  // 2. Mint the credential.
  const { rawToken, tokenPrefix, tokenHash } = issueRawToken()
  const credential = await prisma.headlessCredential.create({
    data: {
      ownerId: owner.id,
      name: TEST_NAME,
      tokenHash,
      tokenPrefix,
      allowedTools: [
        'enhance_prompt',
        'iterate_prompt',
        'list_models',
        'generate_asset',
        'list_product_renders',
      ],
      allowedModels: ['*'],
    },
    select: { id: true, tokenPrefix: true, createdAt: true },
  })
  console.log(`  Token    : ${tokenPrefix}_********  (id ${credential.id})`)

  const url = `${BASE.replace(/\/$/, '')}/api/mcp/${rawToken}`
  console.log(`  Endpoint : ${BASE}/api/mcp/${tokenPrefix}_********`)
  console.log('')

  try {
    // 3a. initialize
    console.log('Step 1: initialize')
    const init = await rpc(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-url-smoke-test', version: '0.1.0' },
      },
    })
    if (init.status !== 200) {
      fail(`HTTP ${init.status} on initialize`, init.body || init.raw)
    } else if (!init.body?.result?.serverInfo?.name) {
      fail('initialize did not return serverInfo.name', init.body)
    } else {
      ok(
        `initialize -> ${init.body.result.serverInfo.name} v${init.body.result.serverInfo.version} (protocol ${init.body.result.protocolVersion})`,
      )
    }

    // 3b. notifications/initialized (no response expected, server should 202)
    console.log('Step 2: notifications/initialized')
    const initd = await rpc(url, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    if (initd.status === 202 || initd.status === 200) {
      ok(`notifications/initialized -> HTTP ${initd.status}`)
    } else {
      fail(`HTTP ${initd.status} on notifications/initialized`, initd.body || initd.raw)
    }

    // 3c. tools/list
    console.log('Step 3: tools/list')
    const tools = await rpc(url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })
    if (tools.status !== 200) {
      fail(`HTTP ${tools.status} on tools/list`, tools.body || tools.raw)
    } else if (!Array.isArray(tools.body?.result?.tools)) {
      fail('tools/list did not return an array of tools', tools.body)
    } else {
      const names = tools.body.result.tools.map((t) => t.name).sort()
      ok(`tools/list -> [${names.join(', ')}]`)
      const expected = [
        'enhance_prompt',
        'generate_asset',
        'iterate_prompt',
        'list_models',
        'list_product_renders',
      ].sort()
      const matches = JSON.stringify(names) === JSON.stringify(expected)
      if (!matches) {
        fail(`Expected exactly [${expected.join(', ')}], got [${names.join(', ')}]`)
      }
    }

    // 3d. tools/call list_models  (cost-free: reads local registry)
    console.log('Step 4: tools/call list_models')
    const call = await rpc(url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_models', arguments: {} },
    })
    if (call.status !== 200) {
      fail(`HTTP ${call.status} on tools/call`, call.body || call.raw)
    } else if (!call.body?.result?.content?.length) {
      fail('tools/call did not return a content array', call.body)
    } else {
      const totalModels = call.body.result.structuredContent?.total ?? 'unknown'
      const wildcard = call.body.result.structuredContent?.wildcardAccess ?? false
      ok(
        `tools/call list_models -> ${totalModels} models visible (wildcard access: ${wildcard})`,
      )
    }

    // Rate-limit headers: present on every authenticated response.
    const rlMin = tools.headers['x-ratelimit-remaining-minute']
    const rlDay = tools.headers['x-ratelimit-remaining-day']
    if (rlMin !== undefined || rlDay !== undefined) {
      ok(`rate-limit headers visible (minute remaining: ${rlMin ?? 'n/a'}, day remaining: ${rlDay ?? 'n/a'})`)
    }

    // 3e. tools/call list_product_renders  (cost-free: reads Supabase)
    console.log('Step 5: tools/call list_product_renders')
    const renders = await rpc(url, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_product_renders', arguments: {} },
    })
    let firstRenderId = null
    if (renders.status !== 200) {
      fail(`HTTP ${renders.status} on tools/call list_product_renders`, renders.body || renders.raw)
    } else if (renders.body?.result?.isError) {
      fail(`list_product_renders returned isError: true`, renders.body?.result?.content)
    } else {
      const sc = renders.body?.result?.structuredContent
      const total = sc?.total ?? (Array.isArray(sc?.renders) ? sc.renders.length : 0)
      if (total > 0 && Array.isArray(sc.renders) && sc.renders[0]?.id) {
        firstRenderId = sc.renders[0].id
        ok(
          `list_product_renders -> ${total} render(s); first: ${sc.renders[0].name}` +
            (sc.renders[0].colorway ? ` / ${sc.renders[0].colorway}` : '') +
            ` (${firstRenderId})`,
        )
      } else {
        ok(`list_product_renders -> ${total} render(s) (catalog empty or no usable id)`)
      }
    }

    // 3f. Negative test: a wrong token should return 401, not silently work.
    console.log('Step 6: bogus token -> 401')
    const badUrl = `${BASE.replace(/\/$/, '')}/api/mcp/vsp_live_deadbeef_${'0'.repeat(48)}`
    const bad = await rpc(badUrl, {
      jsonrpc: '2.0',
      id: 99,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    })
    if (bad.status === 401) {
      ok(`bogus token -> HTTP 401`)
    } else {
      fail(`Expected HTTP 401 for a bogus token, got ${bad.status}`, bad.body || bad.raw)
    }

    // 3g. Optional: real image generation. Costs real money on Gemini, so
    // gated behind --with-generate. Uses the cheapest, fastest image model.
    if (WITH_GENERATE) {
      console.log('Step 7: tools/call generate_asset (--with-generate)')
      const gen = await rpc(url, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'generate_asset',
          arguments: {
            modelId: 'gemini-nano-banana-2',
            prompt:
              'A clean studio still of a single Loop Switch earplug on a soft cream background, soft daylight, brand-fluent, square crop',
            numOutputs: 1,
          },
        },
      })
      if (gen.status !== 200) {
        fail(`HTTP ${gen.status} on tools/call generate_asset`, gen.body || gen.raw)
      } else if (gen.body?.result?.isError) {
        fail(`generate_asset returned isError: true`, gen.body?.result?.content)
      } else {
        const content = gen.body?.result?.content ?? []
        const images = content.filter((c) => c.type === 'image')
        if (images.length === 0) {
          fail('generate_asset returned no image content blocks', gen.body)
        } else {
          const sc = gen.body.result.structuredContent
          const cost = sc?.estimatedCostUsd
          const dim = sc?.outputs?.[0]
          const sizeKB = images[0]?.data ? Math.round((images[0].data.length * 3) / 4 / 1024) : 0
          ok(
            `generate_asset -> ${images.length} image(s), ${dim?.width ?? '?'}x${dim?.height ?? '?'} ${images[0]?.mimeType ?? '?'}, ~${sizeKB}KB, ${sc?.durationMs ?? '?'}ms, est cost $${cost ?? 'unknown'}`,
          )
        }
      }

      // 3h. Optional: generate_asset with productRenderIds, exercising the
      // new product-render shortcut end-to-end. Skipped silently if the
      // catalog returned no usable ID in Step 5.
      if (firstRenderId) {
        console.log('Step 8: tools/call generate_asset with productRenderIds (--with-generate)')
        const genRef = await rpc(url, {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'generate_asset',
            arguments: {
              modelId: 'gemini-nano-banana-2',
              prompt:
                'Re-photograph the referenced Loop earplug as a clean studio still on a soft cream background, soft daylight, square crop',
              productRenderIds: [firstRenderId],
              numOutputs: 1,
            },
          },
        })
        if (genRef.status !== 200) {
          fail(`HTTP ${genRef.status} on generate_asset+productRenderIds`, genRef.body || genRef.raw)
        } else if (genRef.body?.result?.isError) {
          fail(
            `generate_asset+productRenderIds returned isError: true`,
            genRef.body?.result?.content,
          )
        } else {
          const content = genRef.body?.result?.content ?? []
          const images = content.filter((c) => c.type === 'image')
          if (images.length === 0) {
            fail('generate_asset+productRenderIds returned no image content blocks', genRef.body)
          } else {
            const sc = genRef.body.result.structuredContent
            const dim = sc?.outputs?.[0]
            const sizeKB = images[0]?.data
              ? Math.round((images[0].data.length * 3) / 4 / 1024)
              : 0
            ok(
              `generate_asset+productRenderIds -> ${images.length} image(s), ${dim?.width ?? '?'}x${dim?.height ?? '?'} ${images[0]?.mimeType ?? '?'}, ~${sizeKB}KB, ${sc?.durationMs ?? '?'}ms`,
            )
          }
        }
      } else {
        console.log('Step 8: skipped (no productRender id available from Step 5)')
      }
    }
  } finally {
    // 4. Always revoke the test credential, even if a step failed.
    await prisma.headlessCredential.update({
      where: { id: credential.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'mcp-url-smoke-test cleanup',
      },
    })
    console.log('')
    console.log(`Cleanup  : revoked test credential ${credential.id}`)
    await prisma.$disconnect()
  }
}

main().catch(async (err) => {
  console.error('FATAL:', err)
  try {
    await prisma.$disconnect()
  } catch {
    /* already disconnected */
  }
  process.exitCode = 1
})
