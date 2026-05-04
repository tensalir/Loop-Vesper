// Quick smoke check that the new column is queryable end-to-end.
// Run with: node prisma/migrations/manual/verify-headless-access.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const sample = await prisma.profile.findFirst({
    select: { id: true, role: true, headlessAccess: true },
  })
  console.log('Sample profile row:', JSON.stringify(sample, null, 2))

  const grantedCount = await prisma.profile.count({
    where: { headlessAccess: true },
  })
  console.log(`Profiles with headlessAccess=true: ${grantedCount}`)
} catch (err) {
  console.error('FAILED:', err.message)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
