/**
 * One-shot migration applier for the product-updates tables.
 *
 * Reads `prisma/migrations/20260518_add_product_updates/migration.sql` and
 * executes it against the configured database. Idempotent thanks to the
 * `IF NOT EXISTS` guards around each table/index.
 *
 * Used because the workspace mixes Prisma migrations with a `prisma/migrations/manual`
 * folder of raw SQL snippets — `prisma migrate deploy` can't reconcile that
 * shape, so we run the new migration directly while keeping the migration
 * file authoritative for future tools.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'

const DEFAULT_PATHS = [
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260518_add_product_updates',
    'migration.sql'
  ),
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    'manual',
    '2026-05-18-product-updates-rls.sql'
  ),
]

async function applyFile(filePath: string) {
  const sql = readFileSync(filePath, 'utf-8')
  // Rewrite CREATE TABLE / CREATE INDEX to IF NOT EXISTS so re-applies are
  // safe. We don't touch the original migration file; the regex stays here.
  const idempotent = sql
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/CREATE UNIQUE INDEX "/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "')
    .replace(/CREATE INDEX "/g, 'CREATE INDEX IF NOT EXISTS "')

  // Strip line comments first, then split on semicolons. This handles SQL
  // files where each statement is preceded by a `-- CreateTable` comment.
  const stripped = idempotent
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n')

  const statements = stripped
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  console.log(`[updates-migrate] ${filePath}: applying ${statements.length} statements…`)
  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt)
      console.log(`  ok: ${stmt.slice(0, 80)}${stmt.length > 80 ? '…' : ''}`)
    } catch (err) {
      const msg = (err as Error).message
      // The ADD CONSTRAINT FK statements have no IF NOT EXISTS guard; treat
      // a duplicate-FK error as "already applied" rather than a hard fail.
      if (/already exists|duplicate/i.test(msg)) {
        console.log(`  skip (exists): ${stmt.slice(0, 80)}…`)
        continue
      }
      throw err
    }
  }
}

async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const targets = files.length > 0 ? files : DEFAULT_PATHS
  for (const file of targets) {
    await applyFile(file)
  }
  console.log('[updates-migrate] done.')
}

main()
  .catch((err) => {
    console.error('[updates-migrate] fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
