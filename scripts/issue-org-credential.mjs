/**
 * Issue (or rotate) the org-shared headless credential.
 *
 * Mints a single Vesper credential with all five MCP tools enabled,
 * wildcard model access, and high rate limits, owned by the active admin
 * profile. The intended use is the Claude Teams "everyone uses one URL"
 * pattern: the admin pastes the printed URL into the org-level connector
 * and shares it with team members for their own Cowork install.
 *
 * Behaviour:
 *   - Looks for an existing active credential named "Loop Claude
 *     Enterprise Org". If one exists, revokes it before issuing a new
 *     one (atomic rotate; no overlapping active org credentials).
 *   - Picks an admin owner: --ownerId UUID, otherwise the first active
 *     admin profile we find.
 *   - Prints the plaintext URL ONCE. The DB stores only the SHA-256
 *     hash. After this script exits the only place the URL exists is
 *     wherever the operator pastes it.
 *
 * Run with:
 *   node scripts/issue-org-credential.mjs
 *   node scripts/issue-org-credential.mjs --base https://loopvesper-one.vercel.app
 *   node scripts/issue-org-credential.mjs --name "Loop Studio Team" --owner <profileUuid>
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'

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

const BASE =
  (typeof args.base === 'string' ? args.base : '').trim() ||
  'https://loopvesper-one.vercel.app'
const NAME =
  (typeof args.name === 'string' ? args.name : '').trim() ||
  'Loop Claude Enterprise Org'
const OWNER_OVERRIDE =
  typeof args.owner === 'string' ? args.owner.trim() : null

// Defaults intentionally mirror src/app/api/admin/headless-credentials/org/route.ts
// so this script stays a faithful CLI mirror of the HTTP endpoint.
const ALLOWED_TOOLS = [
  'enhance_prompt',
  'iterate_prompt',
  'list_models',
  'generate_asset',
  'list_product_renders',
]
const ALLOWED_MODELS = ['*']
const RATE_LIMIT_PER_MINUTE = 200
const RATE_LIMIT_PER_DAY = 20_000

const prisma = new PrismaClient()

function issueRawToken() {
  const prefixRandom = crypto.randomBytes(8).toString('hex')
  const secretRandom = crypto.randomBytes(24).toString('hex')
  const tokenPrefix = `vsp_live_${prefixRandom}`
  const rawToken = `${tokenPrefix}_${secretRandom}`
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  return { rawToken, tokenPrefix, tokenHash }
}

async function main() {
  const owner = OWNER_OVERRIDE
    ? await prisma.profile.findUnique({
        where: { id: OWNER_OVERRIDE },
        select: { id: true, displayName: true, role: true, deletedAt: true, pausedAt: true },
      })
    : await prisma.profile.findFirst({
        where: { role: 'admin', deletedAt: null, pausedAt: null },
        select: { id: true, displayName: true, role: true, deletedAt: true, pausedAt: true },
      })

  if (!owner) {
    console.error('FATAL: could not find an owner profile.')
    console.error('Pass --owner <profileUuid> or seed an active admin profile first.')
    process.exitCode = 1
    return
  }

  if (owner.deletedAt || owner.pausedAt) {
    console.error(
      `FATAL: owner ${owner.id} is deleted or paused; refusing to attach a credential to an inactive profile.`,
    )
    process.exitCode = 1
    return
  }

  console.log('Issuing org-shared Vesper credential')
  console.log(`  Name      : ${NAME}`)
  console.log(`  Owner     : ${owner.displayName || owner.id} (${owner.role})`)
  console.log(`  Base URL  : ${BASE}`)
  console.log(`  Tools     : ${ALLOWED_TOOLS.join(', ')}`)
  console.log(`  Models    : ${ALLOWED_MODELS.join(', ')}`)
  console.log(`  Rate cap  : ${RATE_LIMIT_PER_MINUTE}/min, ${RATE_LIMIT_PER_DAY}/day`)
  console.log('')

  // Atomic-ish rotation: if a previous active org credential with this
  // name exists, revoke it first so there is exactly one active org
  // credential at a time. Anyone still using the old URL gets a 401 the
  // moment this completes — that's intentional.
  const existing = await prisma.headlessCredential.findMany({
    where: { name: NAME, revokedAt: null },
    select: { id: true, tokenPrefix: true, createdAt: true },
  })

  for (const e of existing) {
    await prisma.headlessCredential.update({
      where: { id: e.id },
      data: {
        revokedAt: new Date(),
        revokedReason: `Rotated by issue-org-credential.mjs at ${new Date().toISOString()}`,
      },
    })
    console.log(
      `  Rotated   : revoked previous active org credential ${e.tokenPrefix}_******** (id ${e.id})`,
    )
  }

  // Mint the new credential.
  const { rawToken, tokenPrefix, tokenHash } = issueRawToken()
  const credential = await prisma.headlessCredential.create({
    data: {
      ownerId: owner.id,
      name: NAME,
      tokenHash,
      tokenPrefix,
      allowedTools: ALLOWED_TOOLS,
      allowedModels: ALLOWED_MODELS,
      rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
      rateLimitPerDay: RATE_LIMIT_PER_DAY,
    },
    select: { id: true, tokenPrefix: true, createdAt: true },
  })

  const url = `${BASE.replace(/\/$/, '')}/api/mcp/${rawToken}`

  console.log('')
  console.log('  Issued    : credential id ' + credential.id)
  console.log('  Prefix    : ' + tokenPrefix)
  console.log('  Created   : ' + credential.createdAt.toISOString())
  console.log('')
  console.log('  ============================================================')
  console.log('  Server URL (paste into Claude Teams admin connectors panel):')
  console.log('  ' + url)
  console.log('  ============================================================')
  console.log('')
  console.log(
    '  Treat this URL like a password. The DB only holds the SHA-256 hash;',
  )
  console.log(
    '  this is the only time the plaintext is shown. To rotate later,',
  )
  console.log('  re-run this script (it auto-revokes the previous active one).')
}

main()
  .catch((err) => {
    console.error('FATAL:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
