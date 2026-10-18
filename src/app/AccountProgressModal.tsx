import { useCallback, useEffect, useMemo, useState } from 'react'
import { accountTimeline, accountHighlights, type AccountTrade } from './accountReplay'
import { ReplayVideoModal } from './ReplayVideoModal'
import { drawAccountReplay } from './drawAccountReplay'

export function AccountProgressModal({name,wallet,trades,coverage,onClose,loadMarketImage}: {
  name:string;wallet:string;trades:AccountTrade[];coverage:string;onClose:()=>void
  loadMarketImage?:(marketId:string,outcome:string)=>Promise<string|null>
}) {
  const events = useMemo(()=>accountTimeline(trades),[trades])
  const highlights = useMemo(()=>accountHighlights(events),[events])
  const [images,setImages] = useState<Map<string,HTMLImageElement>>(new Map())
  const [assetsReady,setAssetsReady] = useState(false)
  useEffect(()=>{
    let cancelled=false
    const load = (url:string) => new Promise<HTMLImageElement|null>(resolve=>{
      const img=new Image();img.crossOrigin='anonymous'
      const timeout=window.setTimeout(()=>resolve(null),5000)
      img.onload=()=>{clearTimeout(timeout);resolve(img)};img.onerror=()=>{clearTimeout(timeout);resolve(null)}
      // Same-origin, fixed-host image route keeps downloaded canvas untainted.
      let source=url
      try {const parsed=new URL(url,location.origin);if(parsed.hostname==='polymarket-upload.s3.us-east-2.amazonaws.com')source=`/api/market-image${parsed.pathname}`} catch {resolve(null);return}
      img.src=source
    })
    const tasks = highlights.map(async h=>{
      const url=h.image || (loadMarketImage ? await loadMarketImage(h.marketId,h.outcome).catch(()=>null) : null)
      return [h.id,url?await load(url):null] as const
    })
    Promise.all(tasks).then(results=>{
      if(cancelled)return
      const map=new Map<string,HTMLImageElement>()
      for(const [key,img] of results)if(img)map.set(key,img)
      setImages(map);setAssetsReady(true)
    })
    return ()=>{cancelled=true}
  },[highlights,loadMarketImage])
  const draw=useCallback((canvas:HTMLCanvasElement,progress:number)=>{
    drawAccountReplay(canvas,{name,wallet,events,highlights,images,coverage},progress)
  },[name,wallet,events,highlights,images,coverage])
  return <ReplayVideoModal label={`${name} account trade history`} fileName={`${wallet}-account-progress`} draw={draw} ready={assetsReady&&events.length>0}
    description={`${coverage}. Every available closed position contributes to cumulative realized P&L; markers highlight notable wins and losses. Amount traded is the total cost basis of those closed positions.`} onClose={onClose}/>
}
