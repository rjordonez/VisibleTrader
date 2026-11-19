import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from './landing/components/Navbar'
import Footer from './landing/components/Footer'
import './landing/landing.css'
import { supabase } from './lib/supabase'
import { marketingUrl, oauthRedirectUrl } from './lib/domains'
import './creator-dashboard.css'

type Creator = { creator: string; display_name: string; clicks: number | null; clicks_since: string | null; signups: number; active_trials: number | null; paid_conversions: number | null; referral_codes: string[] }
type Report = { creators: Creator[]; updated_at: string }
const number = (n: number) => n.toLocaleString('en-US')
export default function CreatorDashboardPage() {
 const preview=import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview')==='1'
 const [previewRole,setPreviewRole]=useState<'owner'|'creator'>('owner')
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
   if(import.meta.env.DEV && preview){
    const {creatorPreview}=await import('./dev/creatorDashboardPreview')
    if(request!==requestSequence.current)return
    const creators=previewRole==='owner'?creatorPreview.creators:creatorPreview.creators.filter(c=>c.creator==='anthony')
    setReport({...creatorPreview,creators});setSelected(old=>creators.some(c=>c.creator===old)?old:'anthony');setEmail(null);setState('ready');return
   }
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
 },[preview,previewRole])
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
 return <div className="landing">
  <Navbar />
  <main className="blog-content legal-content status-page creator-page">
   <a href={marketingUrl('/')} className="legal-back">← Back to home</a>
   <div className="creator-title-row"><h1 className="blog-title">Creator referrals</h1>{email&&<button className="creator-text-button" onClick={()=>void supabase.auth.signOut()}>Sign out</button>}</div>
   {state==='loading'?<p className="blog-sub">Loading…</p>:state==='anon'?<div className="creator-login"><p>Sign in with your approved account.</p><button className="creator-action" onClick={()=>void signIn()}>Continue with Google</button>{loginError&&<p role="alert">{loginError}</p>}</div>:state==='denied'?<div className="creator-login"><p>This account doesn’t have access.</p><button className="creator-action" onClick={()=>void supabase.auth.signOut()}>Use another account</button></div>:state==='error'?<div className="creator-login"><p>Couldn’t load stats.</p><button className="creator-action" onClick={()=>void load()}>Try again</button></div>:<>
   <div className="status-banner creator-controls">{report&&report.creators.length>1?<select aria-label="Creator" value={selected} onChange={e=>{setSelected(e.target.value);setCopied(false)}}>{report.creators.map(c=><option key={c.creator} value={c.creator}>{c.display_name}</option>)}</select>:<h2>{active?.display_name??'No creator assigned'}</h2>}<button className="creator-text-button" disabled={refreshing} onClick={()=>void load()}>{refreshing?'Refreshing…':'Refresh'}</button></div>
   {active&&<><ul className="status-list creator-stats">
    <li className="status-row"><div className="status-row-head"><span className="status-name" title="Referral visits, including repeat visits.">Clicks</span><strong>{active.clicks===null?'—':number(active.clicks)}</strong></div></li>
    <li className="status-row"><div className="status-row-head"><span className="status-name">Signups</span><strong>{number(active.signups)}</strong></div></li>
    <li className="status-row"><div className="status-row-head"><span className="status-name" title="People currently in their trial period.">On trial</span><strong>{active.active_trials===null?'—':number(active.active_trials)}</strong></div></li>
    <li className="status-row"><div className="status-row-head"><span className="status-name" title="People who paid for a regular subscription after their trial. The introductory payment does not count.">Converted</span><strong className="creator-converted">{active.paid_conversions===null?'—':number(active.paid_conversions)}</strong></div></li>
   </ul>
   {link&&<div className="creator-link"><a href={link} target="_blank" rel="noreferrer">{link.replace('https://','')}</a><button className="creator-text-button" onClick={()=>void copy()}>{copied?'Copied':'Copy link'}</button></div>}
   <p className="creator-updated" title="Historical signup attribution may be incomplete. A dash means the historical data still needs checking.">{preview?'Preview':'Updated '+(report?new Date(report.updated_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'')}</p></>}
   </>}
   {preview&&<div className="creator-preview"><select aria-label="Preview view" value={previewRole} onChange={e=>setPreviewRole(e.target.value as 'owner'|'creator')}><option value="owner">Owner view</option><option value="creator">Creator view</option></select></div>}
  </main>
  <Footer />
 </div>
}
