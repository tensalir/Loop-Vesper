// Smoke check that the new headless tables are queryable end-to-end
// after applying 2026-05-04-add-headless-tables.sql.
// Run with: node prisma/migrations/manual/verify-headless-tables.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const credCount = await prisma.headlessCredential.count()
  console.log(`headless_credentials rows: ${credCount}`)
  const logCount = await prisma.headlessUsageLog.count()
  console.log(`headless_usage_logs rows: ${logCount}`)
  const bucketCount = await prisma.headlessRateBucket.count()
  console.log(`headless_rate_buckets rows: ${bucketCount}`)

  // Round-trip a no-arg findFirst on the page's exact query.
  const sample = await prisma.headlessCredential.findFirst({
    where: { name: 'Self-issued (vesper-headless)', revokedAt: null },
    select: { tokenPrefix: true, createdAt: true, lastUsedAt: true },
  })
  console.log('Sample self-issued credential:', sample ? sample : 'none yet')
} catch (err) {
  console.error('FAILED:', err.message)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
