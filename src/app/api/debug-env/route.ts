import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'

// Diagnostic endpoint to check environment variables
// Restricted to admin users only
export async function GET() {
  const result = await requireAdmin()
  if (result.response) return result.response

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const databaseUrl = process.env.DATABASE_URL
  const replicateToken = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
  
  return NextResponse.json({
    supabase: {
      hasUrl: Boolean(supabaseUrl),
      urlHost: supabaseUrl ? new URL(supabaseUrl).host : null,
      hasAnonKey: Boolean(supabaseAnonKey),
      anonKeyLength: supabaseAnonKey?.length || 0,
    },
    database: {
      hasUrl: Boolean(databaseUrl),
      isPooler: databaseUrl?.includes('pooler.supabase.com') || false,
    },
    replicate: {
      hasToken: Boolean(replicateToken),
      tokenLength: replicateToken?.length || 0,
    },
    nodeEnv: process.env.NODE_ENV,
  })
}
