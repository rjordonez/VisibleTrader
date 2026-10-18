import { avatarGradient } from './helpers'
import { accountSnapshot, type AccountEvent } from './accountReplay'
import { fitFont, FONT, GREEN, RED, roundRect } from './shareCanvas'
const W=1080,H=1180
const usd=(n:number)=>`${n<0?'−':n>0?'+':''}$${Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:0})}`
const cash=(n:number)=>`$${n.toLocaleString('en-US',{maximumFractionDigits:0})}`
export function drawAccountReplay(canvas:HTMLCanvasElement,data:{name:string;wallet:string;events:AccountEvent[];highlights:AccountEvent[];images:Map<string,HTMLImageElement>;coverage:string},progress:number){
  const ctx=canvas.getContext('2d');if(!ctx)return
  if(canvas.width!==W)canvas.width=W;if(canvas.height!==H)canvas.height=H
  const {name,wallet,events,highlights,images,coverage}=data
  const first=events[0]?.time??0,last=events.at(-1)?.time??first
  const start=first-Math.max(1000,(last-first)*.035),end=Math.max(start+1000,last)
  const cursor=start+(end-start)*progress
  const {index,event}=accountSnapshot(events,cursor)
  const pnl=event?.cumulative??0,accent=pnl>=0?GREEN:RED
  ctx.fillStyle='#5662ff';ctx.fillRect(0,0,W,H)
  ctx.fillStyle='#030312';roundRect(ctx,12,12,W-24,H-24,64);ctx.fill()
  const colors=avatarGradient(wallet.toLowerCase()).match(/#[0-9a-f]{6}/gi)!
  const background=ctx.createLinearGradient(48,48,188,188)
  background.addColorStop(0,colors[0]);background.addColorStop(1,colors[1])
  ctx.save();ctx.beginPath();ctx.arc(118,118,70,0,Math.PI*2);ctx.fillStyle=background;ctx.fill();ctx.clip()
  ctx.translate(63,92);ctx.scale(.7,.7)
  ctx.fillStyle='#0C2557';ctx.fill(new Path2D('M38.9914 32.498C32.5691 38.0021 25.1226 48.7343 15.1622 55.224C11.3094 57.7343 9.14352 61.0649 13.1785 63.2705C23.4997 68.912 48.6107 74.7065 54.5 60.5C60.5108 46.0005 72.503 38.9998 83.503 36.4998C89.2046 35.204 102.625 48.8099 114.497 60.4554C123.854 69.6348 137.961 69.3431 146.948 59.8007C151.248 55.2356 153.948 51.7871 155.55 49.3577C157.565 46.3 155.19 45.5609 151.553 45.9863C136.527 47.7437 104.491 45.8832 93.503 30.4998C83.503 16.5 56.4914 17.5001 38.9914 32.498Z'))
  ctx.strokeStyle='#fff';ctx.lineWidth=9;ctx.stroke(new Path2D('M3 33V40C3 56.5685 16.4315 70 33 70H33.4905C44.2813 70 54.2408 64.2047 59.5726 54.8231L64.8179 45.5936C72.0889 32.7998 90.221 31.9744 98.6243 44.0547L108.965 58.92C113.794 65.8614 121.714 70 130.17 70C144.435 70 156 58.4353 156 44.1696V33C156 16.4315 142.569 3 126 3H33C16.4315 3 3 16.4315 3 33Z'))
  ctx.restore()
  ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#fff';fitFont(ctx,name,700,54,700);ctx.fillText(name,222,102)
  ctx.fillStyle='#8e91ab';ctx.font=`500 30px ${FONT}`;ctx.fillText('VisibleTrader',222,157)
  ctx.fillStyle='#686879';ctx.textAlign='right';ctx.font=`500 26px ${FONT}`
  ctx.fillText(events.length?new Date(end).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'',1020,95)
  const gx=44,gy=310,gw=780,gh=325
  const seen=events.slice(0,index+1).map(e=>e.cumulative)
  const lo=Math.min(0,...seen),hi=Math.max(0,...seen),pad=Math.max((hi-lo)*.14,100)
  const min=lo-pad,max=hi+pad,span=max-min
  const x=(t:number)=>gx+(t-start)/(end-start)*gw
  const y=(v:number)=>gy+gh-(v-min)/span*gh
  ctx.strokeStyle='#23253a';ctx.lineWidth=2;ctx.setLineDash([8,10]);ctx.beginPath();ctx.moveTo(gx,y(0));ctx.lineTo(830,y(0));ctx.stroke();ctx.setLineDash([])
  ctx.beginPath();ctx.moveTo(gx,y(0))
  for(let i=0;i<=index;i++)ctx.lineTo(x(events[i].time),y(events[i].cumulative))
  ctx.lineTo(x(cursor),y(pnl));ctx.strokeStyle=accent;ctx.lineWidth=6;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke()
  const reached=highlights.filter(h=>h.time<=cursor)
  for(const h of reached){
    const px=x(h.time),py=y(h.cumulative),color=h.pnl>0?GREEN:h.pnl<0?RED:'#a0a0b0'
    ctx.save();ctx.beginPath();ctx.arc(px,py,23,0,Math.PI*2);ctx.fillStyle='#17182a';ctx.fill();ctx.clip()
    const logo=images.get(h.id)
    if(logo)ctx.drawImage(logo,px-23,py-23,46,46)
    else{ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font=`700 24px ${FONT}`;ctx.fillText(h.title[0]??'•',px,py+8)}
    ctx.restore();ctx.beginPath();ctx.arc(px,py,25,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.stroke()
  }
  // Only the latest highlighted result gets a caption; all markers remain.
  const active=reached.at(-1)
  if(active){
    const result=`${usd(active.pnl)} · ${active.pnl>0?'Won':active.pnl<0?'Lost':'Break-even'}`
    fitFont(ctx,active.title,600,25,390)
    const titleFont=ctx.font,titleWidth=ctx.measureText(active.title).width
    ctx.font=`700 25px ${FONT}`
    const width=Math.max(titleWidth,ctx.measureText(result).width)+24
    const bx=Math.max(56,Math.min(824-width,x(active.time)-width/2)),by=Math.max(225,Math.min(584,y(active.cumulative)-92))
    ctx.fillStyle='#17182a';roundRect(ctx,bx,by,width,68,12);ctx.fill()
    ctx.textAlign='left';ctx.fillStyle='#e4e4ec';ctx.font=titleFont;ctx.fillText(active.title,bx+12,by+26)
    ctx.fillStyle=active.pnl>=0?GREEN:RED;ctx.font=`700 25px ${FONT}`;ctx.fillText(result,bx+12,by+55)
  }
  ctx.textAlign='right';ctx.fillStyle=accent;fitFont(ctx,usd(pnl),700,34,194);ctx.fillText(usd(pnl),1028,Math.max(310,Math.min(635,y(pnl)))+10)
  ctx.fillStyle='#69697d';ctx.font=`500 26px ${FONT}`
  const maxAbs=Math.max(Math.abs(lo),Math.abs(hi))
  const axisRows=[y(pnl)],ticks:number[]=[]
  for(let power=2;power<=Math.ceil(Math.log10(Math.max(100,maxAbs)));power++)for(const mult of[1,2,5])for(const sign of[-1,1])ticks.push(sign*mult*10**power)
  for(const tick of ticks.sort((a,b)=>Math.abs(b)-Math.abs(a))){
    const py=y(tick)
    if(tick<lo||tick>hi||py<gy||py>gy+gh||axisRows.some(row=>Math.abs(row-py)<42))continue
    ctx.fillText(`${tick<0?'−':''}$${Math.abs(tick)>=1000?`${Math.abs(tick)/1000}k`:Math.abs(tick)}`,1028,py+9)
    axisRows.push(py)
  }
  ctx.textAlign='center';ctx.fillStyle='#77778c';ctx.font=`500 23px ${FONT}`
  for(let i=1;i<=3;i++){const t=start+(end-start)*i/4;ctx.fillText(new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'}),gx+gw*i/4,699)}
  ctx.fillStyle='#10101f';roundRect(ctx,36,752,1008,392,36);ctx.fill();ctx.strokeStyle='#2b2b40';ctx.lineWidth=2;ctx.stroke()
  ctx.fillStyle='#b0b0c2';ctx.font=`500 32px ${FONT}`;ctx.fillText('Cumulative P&L',540,817)
  ctx.fillStyle=accent;fitFont(ctx,usd(pnl),700,104,900);ctx.fillText(usd(pnl),540,944)
  ctx.fillStyle='#707085';fitFont(ctx,coverage,500,24,900);ctx.fillText(coverage,540,980)
  ctx.fillStyle='#262637';ctx.fillRect(36,1008,1008,2)
  const count=event?.count??0,wins=event?.wins??0
  const stats=[['Amount traded',cash(event?.deployed??0)],['Trades closed',String(count)],['Win rate',count?`${(wins/count*100).toFixed(1)}%`:'—']]
  stats.forEach(([label,value],i)=>{const mid=204+336*i;if(i){ctx.fillStyle='#262637';ctx.fillRect(36+336*i,1010,2,134)}ctx.textAlign='center';ctx.fillStyle='#b0b0c2';ctx.font=`500 29px ${FONT}`;ctx.fillText(label,mid,1061);ctx.fillStyle=i===2?GREEN:'#fff';fitFont(ctx,value,600,42,280);ctx.fillText(value,mid,1117)})
}
