// QA_PACKAGE_DIR=/tmp/vt-referral-qa CHROMIUM_PATH=/path/to/chromium node scripts/creator-dashboard-browser.test.mjs
// Start the dummy-backend Vite server on :5210; see docs/creator-dashboard.md.
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {strict as assert} from 'node:assert'
const require=createRequire(`${process.env.QA_PACKAGE_DIR||process.cwd()}/package.json`)
const {chromium}=require('playwright')
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})})
const fixtures=process.env.CREATOR_PREVIEW_DATA?JSON.parse(await readFile(process.env.CREATOR_PREVIEW_DATA,'utf8')):(await import('../src/dev/creatorDashboardPreview.ts')).creatorPreview.creators
const output=process.env.CREATOR_SCREENSHOT_DIR||'/tmp'
let mode='owner'
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}})
 const user={id:'00000000-0000-0000-0000-000000000001',email:'tavasyag@gmail.com',role:'authenticated',aud:'authenticated',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'google'},user_metadata:{onboarding_completed:true},identities:[]}
 const exp=Math.floor(Date.now()/1000)+3600
 const jwt=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp,role:'authenticated'})).toString('base64url')+'.qa'
 await context.addInitScript(({user,exp,jwt})=>localStorage.setItem('sb-creator-preview-auth-token',JSON.stringify({access_token:jwt,refresh_token:'qa-refresh',expires_at:exp,expires_in:3600,token_type:'bearer',user})),{user,exp,jwt})
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='127.0.0.1')return url.pathname.startsWith('/analytics/')?route.fulfill({json:{}}):route.continue()
  if(url.hostname!=='creator-preview.supabase.co')return route.abort()
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:user})
  if(url.pathname.endsWith('/capture_signup_referral'))return route.fulfill({status:204,body:''})
  if(url.pathname.endsWith('/creator_dashboard')){
   if(mode==='denied')return route.fulfill({status:403,json:{code:'42501',message:'Access denied'}})
   if(mode==='error')return route.fulfill({status:503,json:{message:'Temporarily unavailable'}})
   return route.fulfill({json:{creators:mode==='creator'?fixtures.filter(c=>c.creator==='anthony'):fixtures,updated_at:new Date().toISOString()}})
  }
  return route.fulfill({status:204,body:''})
 })
 const page=await context.newPage()
 await page.goto('http://127.0.0.1:5210/app/creator-dashboard')
 await page.getByRole('heading',{name:'Creator referrals',exact:true}).waitFor()
 assert.equal(await page.getByRole('combobox',{name:'Creator',exact:true}).locator('option').count(),21)
 await page.getByRole('combobox',{name:'Creator',exact:true}).selectOption('anthony')
 assert.deepEqual(await page.locator('.creator-stats strong').allTextContents(),['16','0','0','0'])
 await page.screenshot({path:output+'/creator-referrals-desktop.png',fullPage:true})
 mode='creator'
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await page.getByRole('heading',{name:'Anthony Babin',exact:true}).waitFor()
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 await page.screenshot({path:output+'/creator-referrals-mobile.png',fullPage:true})
 mode='denied'
 await page.getByRole('button',{name:'Refresh',exact:true}).click()
 await page.getByText('This account doesn’t have access.',{exact:true}).waitFor()
 assert.equal(await page.locator('.creator-stats').count(),0)
 console.log('PASS: owner roster, creator-only results, recorded metrics, mobile layout, and access-denied state')
 await context.close()
}finally{await browser.close()}
