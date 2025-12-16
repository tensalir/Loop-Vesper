import { PrismaClient, Prisma } from '@prisma/client'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Configure it in .env.local and Vercel before running the app.')
}

// Validate connection string for serverless environments
const usesSessionPooler = /pooler\.supabase\.com:5432/i.test(databaseUrl)
if (usesSessionPooler) {
  console.warn(
    'DATABASE_URL points to the Supabase session pooler (port 5432). Consider using the transaction pooler (port 6543) with ?pgbouncer=true&connection_limit=1 for better serverless stability.'
  )
}

if (!/connection_limit=/i.test(databaseUrl) && /pooler\.supabase\.com/i.test(databaseUrl)) {
  console.warn('DATABASE_URL missing connection_limit parameter. Add ?connection_limit=1 for serverless stability.')
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Configure Prisma for serverless with connection pooling
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const MAX_RETRIES = 3

async function warmPrismaConnection(attempt = 0): Promise<void> {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`)
  } catch (error) {
    if (attempt >= MAX_RETRIES - 1) {
      console.error('Prisma connection failed after retries', error)
      throw error
    }
    const delay = Math.min(500 * 2 ** attempt, 4000)
    console.warn(`Prisma connection failed (attempt ${attempt + 1}). Retrying in ${delay}ms.`)
    await sleep(delay)
    return warmPrismaConnection(attempt + 1)
  }
}

if (process.env.NODE_ENV !== 'test') {
  warmPrismaConnection().catch((error) => {
    console.error('Prisma warmup failed. Subsequent queries may still succeed.', error)
  })
}

