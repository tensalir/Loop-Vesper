import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from './types'

export const createClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'lib/supabase/client.ts:createClient',message:'supabase env snapshot',data:{hasSupabaseUrl:Boolean(supabaseUrl),supabaseUrlHost:(supabaseUrl||'').replace(/^https?:\/\//,'').split('/')[0],looksLikeSupabase:Boolean(supabaseUrl && supabaseUrl.includes('supabase.co')),hasAnonKey:Boolean(supabaseAnonKey)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables')
  }
  
  return createClientComponentClient<Database>()
}

