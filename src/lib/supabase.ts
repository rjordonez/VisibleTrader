import { createClient } from '@supabase/supabase-js'

// Local dev normally points at the separate dev Supabase project
// (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY in .env.local). Setting
// VITE_USE_PROD_DB=true there switches this client to the real production
// project instead — for occasionally checking against real data without
// swapping the whole .env.local. isProdDb is exported so the UI can show a
// visible warning; there's no silent way to be pointed at prod.
export const isProdDb = import.meta.env.VITE_USE_PROD_DB === 'true'

const url = isProdDb ? import.meta.env.VITE_PROD_SUPABASE_URL : import.meta.env.VITE_SUPABASE_URL
const anonKey = isProdDb ? import.meta.env.VITE_PROD_SUPABASE_ANON_KEY : import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  const which = isProdDb
    ? 'VITE_PROD_SUPABASE_URL / VITE_PROD_SUPABASE_ANON_KEY (VITE_USE_PROD_DB=true)'
    : 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'
  throw new Error(`Missing ${which} — check .env.local`)
}

if (isProdDb) {
  console.warn('%c⚠ Connected to PRODUCTION Supabase — writes here affect real data.', 'color: #ff3b5c; font-weight: 700; font-size: 13px;')
}

export const supabase = createClient(url, anonKey)
