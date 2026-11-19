import {strict as assert} from 'node:assert'
let handler: (req:Request)=>Promise<Response>
const serve=Deno.serve
Deno.serve=((h:typeof handler)=>{handler=h;return {}}) as unknown as typeof Deno.serve
Deno.env.set('SUPABASE_URL','https://click-qa.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','qa-server-secret')
await import('./index.ts')
Deno.serve=serve
const originalFetch=globalThis.fetch
let calls=0
let dbFails=false
let accepted=true
globalThis.fetch=(async (_input:unknown,init?:RequestInit)=>{
 calls++
 const body=JSON.parse(String(init?.body))
 assert.equal(body.p_code,'anthony')
 assert.equal(body.p_event_id,'00000000-0000-0000-0000-000000000001')
 assert.match(body.p_network_hash,/^[a-f0-9]{64}$/)
 assert.equal(String(init?.body).includes('1.2.3.4'),false)
 return new Response(JSON.stringify(dbFails?{message:'database offline'}:accepted),{status:dbFails?500:200,headers:{'Content-Type':'application/json'}})
}) as typeof fetch
const request=(origin='https://visibletrader.com',body:unknown={code:'anthony',event_id:'00000000-0000-0000-0000-000000000001'})=>new Request('https://click-qa.supabase.co/record-creator-click',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'1.2.3.4'},body:JSON.stringify(body)})
Deno.test('public ingestion validates origin and body; never returns private data',async()=>{
 assert.equal((await handler(request('https://untrusted.example'))).status,403)
 assert.equal((await handler(request('https://visibletrader.com',{code:'anthony',event_id:'invalid'}))).status,400)
 assert.equal(calls,0)
 const response=await handler(request())
 assert.equal(response.status,204)
 assert.equal(await response.text(),'')
 accepted=false
 assert.equal((await handler(request())).status,429)
 dbFails=true
 assert.equal((await handler(request())).status,503)
})
Deno.test('restore fetch',()=>{globalThis.fetch=originalFetch})
