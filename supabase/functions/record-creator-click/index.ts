import { createClient } from 'jsr:@supabase/supabase-js@2'
const origins = new Set(['https://visibletrader.com','https://www.visibletrader.com','https://app.visibletrader.com'])
Deno.serve(async req => {
 const origin=req.headers.get('origin') || ''
 const headers={ 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://visibletrader.com', 'Access-Control-Allow-Headers':'content-type, apikey', 'Access-Control-Allow-Methods':'POST, OPTIONS', Vary:'Origin' }
 if (!origins.has(origin)) return new Response(null,{status:403})
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers})
 if(req.method!=='POST') return new Response(null,{status:405,headers})
 try {
  const body=await req.text()
  if(body.length>1024) return new Response(null,{status:413,headers})
  const {code,event_id}=JSON.parse(body)
  if(typeof code!=='string'||code.length>80||typeof event_id!=='string'|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event_id)) return new Response(null,{status:400,headers})
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if(!ip) return new Response(null,{status:400,headers})
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${secret}:${new Date().toISOString().slice(0,10)}:${ip}`))
  const networkHash=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('')
  const db=createClient(Deno.env.get('SUPABASE_URL')!,secret)
  const {data,error}=await db.rpc('record_creator_link_click',{p_event_id:event_id,p_code:code,p_network_hash:networkHash})
  if(error) return new Response(null,{status:503,headers})
  return new Response(null,{status:data?204:429,headers})
 } catch { return new Response(null,{status:400,headers}) }
})
