// All external HTTP and Supabase WebSocket requests are mocked; no account credentials or trades are sent.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const artifacts = process.env.CONNECTION_TEST_ARTIFACTS || join(tmpdir(), 'venter-connection-checks')
await mkdir(artifacts, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
const signer = `0x${'1'.repeat(40)}`
const wallet = `0x${'a'.repeat(40)}`
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'connection-test@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: { onboarding_completed: true, full_name: 'Connection Test' }, app_metadata: {}, created_at: new Date().toISOString() }
const token = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})).toString('base64url'),'test-signature'].join('.')
const waitText = async (page, text) => await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible' })

async function scenario(width, withWallet = false) {
  const context = await browser.newContext({ viewport: { width, height: 950 } })
  let connection = null
  let usConnection = null
  let entries = []
  let failSnapshot = false
  const actions = []
  const errors = []
  await context.addInitScript(({user,token,withWallet,signer}) => {
    localStorage.setItem('sb-lfebcdrczausvohsyxfa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user }))
    if (withWallet) {
      window.walletMode = 'reject'
      window.walletMethods = []
      const listeners = new Map()
      const provider = {
        request: async ({method}) => {
          window.walletMethods.push(method)
          if (method === 'eth_requestAccounts' && window.walletMode === 'reject') throw { code: 4001 }
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [signer]
          if (method === 'personal_sign') {
            if (window.walletMode === 'changed') for (const fn of (listeners.get('accountsChanged') || [])) fn([`0x${'2'.repeat(40)}`])
            return `0x${'b'.repeat(130)}`
          }
          throw new Error(`Unexpected wallet request: ${method}`)
        },
        on: (event, fn) => listeners.set(event, [...(listeners.get(event)||[]),fn]),
        removeListener: (event, fn) => listeners.set(event, (listeners.get(event)||[]).filter(x=>x!==fn)),
      }
      window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail:{info:{uuid:'mock-wallet',name:'Test Wallet'},provider}})))
    }
  }, {user,token,withWallet,signer})
  await context.routeWebSocket(/supabase/, ws => ws.close())
  await context.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname === '127.0.0.1') return route.continue()
    if (!url.hostname.endsWith('supabase.co')) return route.fulfill({status:200,contentType:'application/json',body:'{}'})
    const send = (data, status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
    if (url.pathname === '/auth/v1/user') return send(user)
    if (url.pathname.includes('/rest/v1/subscriptions')) return send([{status:'active',plan:'pro'}])
    if (url.pathname.includes('/rest/v1/personal_pnl_entries')) {
      if (req.method() === 'POST') { const entry = req.postDataJSON(); entries = [entry]; return send(entry) }
      if (req.method() === 'DELETE') { entries = []; return send(null) }
      return send(entries)
    }
    if (url.pathname.includes('/rest/v1/polymarket_us_connections')) return send(usConnection ? [usConnection] : [])
    if (url.pathname.includes('/functions/v1/polymarket-us-connect')) {
      const body = req.postDataJSON()
      if (body.action === 'connect') { usConnection = { key_id: 'demo-key', status: 'active', connected_at: new Date().toISOString() }; return send({ connection: usConnection }) }
      if (body.action === 'snapshot') return send({ connection: usConnection, activity: [], resource_errors: { positions: 'Polymarket US positions are currently unavailable. Activity is still available in Trades.' }, fetched_at: new Date().toISOString() })
      if (body.action === 'disconnect') { usConnection = null; return send({ disconnected: true }) }
    }
    if (url.pathname.includes('/rest/v1/polymarket_connections')) return send(connection ? [connection] : [])
    if (url.pathname.includes('/functions/v1/polymarket-connect')) {
      const body=req.postDataJSON(); actions.push(body.action)
      if(body.action==='lookup') return send({profile:{display_name:'Demo Trader',wallet_address:wallet}})
      if(body.action==='challenge') return send({message:'Verify tracking only',nonce:'test-nonce'})
      if(body.action==='verify' || body.action==='track') {
        connection={wallet_address:wallet,display_name:'Demo Trader',signer_address:body.action==='verify'?signer:null,verified_at:body.action==='verify'?new Date().toISOString():null,connected_at:new Date().toISOString()}
        return send({connection})
      }
      if(body.action==='snapshot') {
        if(failSnapshot) return send({error:'Polymarket is temporarily unavailable. Please try again shortly.'},502)
        return send({connection, fetched_at:new Date().toISOString(),positions_limited:false,positions:[{asset:'1',title:'Will the next launch happen this month?',outcome:'Yes',size:40,current_value:24.8,cash_pnl:4.8,redeemable:false}],activity:[{transaction_hash:'demo',asset:'1',timestamp:1789000000,title:'Will the next launch happen this month?',outcome:'Yes',side:'Buy',amount:20,size:40,price:.5}]})
      }
      if(body.action==='disconnect'){connection=null;return send({disconnected:true})}
      throw new Error(`Unexpected connection action: ${body.action}`)
    }
    if(url.pathname.startsWith('/rest/')) return send([])
    return send({})
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const origin = process.env.CONNECTION_TEST_ORIGIN || 'http://127.0.0.1:5180'
  await page.goto(origin + '/app/journal')
  await page.getByRole('heading', { name: 'Your trading story starts here.' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no page overflow')
  await page.screenshot({path: artifacts + '/journal-empty-' + width + '.png', fullPage:true})
  await page.getByRole('button',{name:'Connect your account',exact:true}).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({path: artifacts + '/choose-' + width + '.png', fullPage:true})
  await page.getByRole('button',{name:'Polymarket US United States · API key'}).click()
  await page.getByLabel('Key ID', {exact:true}).fill('demo-key')
  await page.getByLabel('Secret Key', {exact:true}).fill('synthetic-test-key')
  await page.getByRole('button',{name:'Show secret key'}).click()
  assert.equal(await page.getByLabel('Secret Key', {exact:true}).getAttribute('type'), 'text')
  await page.screenshot({path: artifacts + '/us-' + width + '.png', fullPage:true})
  await page.getByRole('button',{name:'Choose another platform'}).click()
  await page.getByRole('button',{name:'Polymarket International · Wallet or public profile'}).click()
  if(withWallet){
    await page.getByRole('button',{name:'Test Wallet',exact:true}).click()
    await waitText(page,'Connection canceled in your wallet. You can try again whenever you’re ready.')
    await page.evaluate(()=>window.walletMode='changed')
    await page.getByRole('button',{name:'Test Wallet',exact:true}).click()
    await waitText(page,'The wallet changed. Please reconnect with your Polymarket wallet.')
    assert.equal(actions.includes('verify'),false,'wallet change must prevent verification')
    await page.evaluate(()=>window.walletMode='ok')
    await page.getByRole('button',{name:'Test Wallet',exact:true}).click()
    assert.equal((await page.evaluate(()=>window.walletMethods)).includes('eth_sendTransaction'),false)
  }else{
    await waitText(page,'No browser wallet detected')
    await page.getByRole('button',{name:'Track profile',exact:true}).click()
    await page.getByLabel('Polymarket profile or wallet address').fill('https://polymarket.com/profile/' + wallet)
    await page.getByRole('button',{name:'Find my account',exact:true}).click()
    await waitText(page,'Tracking only · ownership not verified')
    await page.screenshot({path: artifacts + '/profile-' + width + '.png', fullPage:true})
    await page.getByRole('button',{name:'Track this account',exact:true}).click()
  }
  await waitText(page,'Will the next launch happen this month?')
  await page.screenshot({path: artifacts + '/portfolio-' + width + '.png', fullPage:true})
  await page.getByRole('button',{name:'Trades',exact:true}).click()
  await waitText(page,'Buy')
  await page.getByRole('button',{name:'Review day',exact:true}).click()
  await page.getByRole('dialog').waitFor()
  await page.getByLabel('Note (optional)').fill('Stayed patient with my entry.')
  await page.getByRole('button',{name:'Save',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  assert.equal(entries[0].note,'Stayed patient with my entry.')
  assert.equal(entries[0].amount,0)
  await page.screenshot({path: artifacts + '/calendar-' + width + '.png', fullPage:true})
  await page.reload()
  await waitText(page,'Will the next launch happen this month?')
  failSnapshot=true
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Showing the last successful update.'}).waitFor()
  await waitText(page,'Will the next launch happen this month?')
  failSnapshot=false
  await page.getByRole('link',{name:'Manage connections',exact:true}).click()
  await page.getByRole('heading',{name:'Connections',exact:true}).waitFor()
  await page.screenshot({path: artifacts + '/settings-' + width + '.png', fullPage:true})
  await page.getByRole('button',{name:'Disconnect Polymarket',exact:true}).click()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.ok(connection)
  await page.getByRole('button',{name:'Disconnect Polymarket',exact:true}).click()
  await page.getByRole('button',{name:'Disconnect',exact:true}).click()
  await page.getByText('Connect a wallet or follow a public profile.',{exact:true}).waitFor()
  assert.equal(connection,null)
  assert.equal(entries.length,1,'disconnect preserves saved journal')
  await page.getByRole('button',{name:'Connect account',exact:true}).click()
  await page.getByRole('button',{name:'Polymarket US United States · API key'}).click()
  await page.getByLabel('Key ID',{exact:true}).fill('demo-key')
  await page.getByLabel('Secret Key',{exact:true}).fill('synthetic-test-key')
  await page.getByRole('button',{name:'Connect Polymarket US',exact:true}).click()
  await page.getByRole('link',{name:'Open Journal'}).click()
  await page.getByText('Polymarket US positions are currently unavailable. Activity is still available in Trades.',{exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'No positions right now'}).count(),0,'unavailable positions must not look empty')
  assert.equal(await page.locator('.connection-metrics strong').first().innerText(),'—','unavailable position value must not look like zero')
  await page.getByRole('button',{name:'Trades',exact:true}).click()
  await page.getByRole('heading',{name:'No recent trades'}).waitFor()
  assert.equal(await page.getByRole('combobox',{name:'Trading account'}).inputValue(),'us')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false, 'no connected page overflow')
  await page.goto(origin + '/app/connections')
  await page.waitForURL('**/app/settings/connections')
  assert.equal(errors.length,0,errors.join('\n'))
  console.log('PASS ' + width + 'px: connection selection, wallet/profile, US credentials, journal review/save, restore, stale data, disconnect, legacy redirect, no overflow/runtime errors')
  await context.close()
}
try{await scenario(1440,true);await scenario(390,false)}finally{await browser.close()}
