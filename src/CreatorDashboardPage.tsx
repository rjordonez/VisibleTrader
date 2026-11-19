import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, LockKeyhole, LogOut, MousePointer2, RefreshCw, ShieldCheck, UserRound, Users, Wallet } from 'lucide-react'
import { supabase } from './lib/supabase'
import { oauthRedirectUrl } from './lib/domains'
import './creator-dashboard.css'

type Creator = { creator: string; display_name: string; clicks: number | null; clicks_since: string | null; signups: number; paid_subscribers: number; regular_paying_subscribers: number; referral_codes: string[] }
type Report = { creators: Creator[]; updated_at: string }
const number = (n: number) => n.toLocaleString('en-US')
export default function CreatorDashboardPage() {
 const requestSequence=useRef(0)
 const [report,setReport]=useState<Report|null>(null)
 const [selected,setSelected]=useState('')
 const [email,setEmail]=useState<string|null>(null)
 const [state,setState]=useState<'loading'|'anon'|'denied'|'error'|'ready'>('loading')
 const [refreshing,setRefreshing]=useState(false)
 const [copied,setCopied]=useState(false)
 const [loginError,setLoginError]=useState('')
 const load=useCallback(async()=>{
  const request=++requestSequence.current
  setRefreshing(true)
  try{
   const {data,error}=await supabase.auth.getUser()
   if(request!==requestSequence.current)return
   if(error||!data.user){setReport(null);setEmail(null);setState('anon');return}
   setEmail(data.user.email??null)
   const response=await supabase.rpc('creator_dashboard')
   if(request!==requestSequence.current)return
   if(response.error){setReport(null);setState(response.error.code==='42501'?'denied':'error');return}
   const result=response.data as Report
   setReport(result);setSelected(old=>result.creators.some(c=>c.creator===old)?old:result.creators[0]?.creator??'');setState('ready')
  }catch{if(request===requestSequence.current){setReport(null);setState('error')}}
  finally{if(request===requestSequence.current)setRefreshing(false)}
 },[])
 useEffect(()=>{
  let disposed=false
  const invalidate=()=>{requestSequence.current++}
  const initial=setTimeout(()=>{if(!disposed)void load()},0)
  const {data}=supabase.auth.onAuthStateChange(event=>{
   if(event==='SIGNED_OUT'){requestSequence.current++;setReport(null);setState('anon');setEmail(null)}
   if(event==='SIGNED_IN'){requestSequence.current++;setReport(null);setState('loading');setTimeout(()=>{if(!disposed)void load()},0)}
  })
  return()=>{disposed=true;invalidate();clearTimeout(initial);data.subscription.unsubscribe()}
 },[load])
 const signIn=async()=>{
  setLoginError('')
  try { sessionStorage.setItem('creator-dashboard-return','1') } catch { /* The direct dashboard link still works after sign-in. */ }
  const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:oauthRedirectUrl()}})
  if(error)setLoginError('Sign-in couldn’t start. Please try again.')
 }
 const active=report?.creators.find(c=>c.creator===selected)
 const link=active?.referral_codes?.[0]?`https://visibletrader.com/r/${active.referral_codes[0]}`:null
 const copy=async()=>{if(!link)return;try{await navigator.clipboard.writeText(link);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch{setCopied(false)}}
 return <div className="creator-portal">
  <aside className="creator-sidebar">
   <a className="creator-brand" href="https://visibletrader.com"><span className="creator-brand-icon">v<span>t</span></span>Visible Trader</a>
   <div className="creator-workspace"><span className="creator-workspace-icon"><Users size={19}/></span><div>Creator workspace<small>Partner insights</small></div><LockKeyhole size={13}/></div>
   <div className="creator-nav"><span><MousePointer2 size={17}/>Referral overview</span></div>
   {state==='ready'&&report&&<div className="creator-roster"><p>{report.creators.length>1?'Your creators':'Your account'}</p>{report.creators.map(c=><button key={c.creator} aria-pressed={selected===c.creator} onClick={()=>{setSelected(c.creator);setCopied(false)}}><span className="creator-avatar">{c.creator.slice(0,2).toUpperCase()}</span><span>{c.display_name}</span>{selected===c.creator&&<span className="creator-selected-dot"/>}</button>)}</div>}
   <div className="creator-sidebar-bottom"><ShieldCheck size={18}/><p>Private by invitation<small>Only approved accounts can view results.</small></p></div>
  </aside>
  <div className="creator-main-wrap"><header className="creator-topbar"><span>Creator workspace <span>/</span> Overview</span><div><span className="creator-private"><LockKeyhole size={12}/>Private</span>{email&&<button title="Sign out" aria-label="Sign out" onClick={()=>void supabase.auth.signOut()}><LogOut size={16}/></button>}</div></header>
   <main className="creator-main">
   {state!=='ready'?<section className="creator-access"><span className="creator-access-icon"><LockKeyhole size={27}/></span><h1>{state==='anon'?'Your results. Your workspace.':state==='denied'?'This workspace is invite-only':state==='error'?'Your results couldn’t load':'Opening your workspace…'}</h1><p>{state==='anon'?'Sign in with the Google account approved by Visible Trader to see your referral results.':state==='denied'?`You're signed in${email?' as '+email:''}. Ask the team to approve this account, or sign out and use an invited account.`:state==='error'?'Try again to get the latest results.':'Checking your access securely.'}</p>{state==='anon'?<button className="creator-primary" onClick={()=>void signIn()}>Continue with Google <ArrowUpRight size={17}/></button>:state==='error'?<button className="creator-primary" onClick={()=>void load()}>Try again</button>:state==='denied'?<button className="creator-primary" onClick={()=>void supabase.auth.signOut()}>Use another account</button>:null}{loginError&&<p role="alert">{loginError}</p>}</section>:<>
    <div className="creator-heading"><div><div className="creator-status"><span/>Partner performance</div><h1>Referral overview</h1><p>See the people your content brings to Visible Trader.</p></div><button className="creator-refresh" disabled={refreshing} onClick={()=>void load()}><RefreshCw size={15} className={refreshing?'creator-spin':''}/>{refreshing?'Refreshing':'Refresh'}</button></div>
    {active?<><div className="creator-account-strip"><div><span className="creator-avatar large">{active.creator.slice(0,2).toUpperCase()}</span><div><strong>{active.display_name}</strong><small>Creator referral performance</small></div></div><span className="creator-period">All recorded activity</span></div>
    <section className="creator-metrics" aria-label="Referral performance"><article><div className="creator-metric-label"><MousePointer2 size={17}/>Clicks</div><strong>{active.clicks===null?'—':number(active.clicks)}</strong><p>{active.clicks===null?'Click history hasn’t been imported yet.':'Visits through your referral links, including repeat visits.'}</p><span className="creator-metric-footer">Your audience finds us</span></article><article><div className="creator-metric-label"><UserRound size={17}/>Signups</div><strong>{number(active.signups)}</strong><p>Accounts created with your referral credit.</p><span className="creator-metric-footer">They create an account</span></article><article className="creator-paid"><div className="creator-metric-label"><Wallet size={17}/>Paying subscribers</div><strong>{number(active.paid_subscribers)}</strong><p>People who made a successful subscription payment.</p><span className="creator-metric-footer">They become a paying customer</span></article></section>
    <section className="creator-link-panel"><div><span className="creator-panel-icon"><ArrowUpRight size={23}/></span><div><h2>Your referral link</h2><p>Share this link so new accounts get credited to you.</p></div></div>{link?<div className="creator-link-copy"><a href={link} target="_blank" rel="noreferrer">{link.replace('https://','')}</a><button onClick={()=>void copy()} aria-label="Copy referral link">{copied?<Check size={17}/>:<Copy size={17}/>}<span>{copied?'Copied':'Copy link'}</span></button></div>:<p>Ask the team to set up your referral link.</p>}</section>
    <section className="creator-details"><div><h2>What the numbers mean</h2><p>Each paying account counts once. Renewals don’t add another subscriber, and canceled accounts keep their payment history.</p></div><div className="creator-payment-detail"><span>Paid beyond the introductory offer</span><strong>{number(active.regular_paying_subscribers)}</strong><small>Introductory payments, including a $1 offer, are included in the headline paying-subscriber count.</small></div></section>
    <div className="creator-data-note"><ShieldCheck size={16}/><p>Older signups with missing referral credit can’t be assigned retroactively. {active.clicks_since?`Clicks tracked since ${new Date(active.clicks_since).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}. `:''}These totals aren’t a same-period conversion funnel.</p></div>
    </>:<div className="creator-empty"><h2>No creators assigned yet</h2><p>Ask the team to connect your account to a creator profile.</p></div>}
    <footer className="creator-footer"><span>Visible Trader creator program</span><span>Updated {report&&new Date(report.updated_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span></footer>
   </>}
   </main>
  </div>
 </div>
}
