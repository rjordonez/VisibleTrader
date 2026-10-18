import {test} from 'node:test'
import assert from 'node:assert/strict'
import {accountTimeline,accountSnapshot,accountHighlights} from '../src/app/accountReplay.ts'
const row=(id,time,pnl)=>({id,marketId:id,title:id,outcome:'Yes',closedAt:new Date(time).toISOString(),invested:100,pnl})
test('all trades contribute in chronological order including losses',()=>{
  const events=accountTimeline([row('b',2000,-40),row('c',3000,60),row('a',1000,100)])
  assert.deepEqual(events.map(e=>e.cumulative),[100,60,120])
  assert.equal(events.at(-1).deployed,300);assert.equal(events.at(-1).wins,2);assert.equal(events.at(-1).count,3)
})
test('cursor never includes future trades',()=>{
  const events=accountTimeline([row('a',1000,100),row('b',2000,-40)])
  assert.equal(accountSnapshot(events,999).event,null)
  assert.equal(accountSnapshot(events,1999).event.cumulative,100)
  assert.equal(accountSnapshot(events,2000).event.cumulative,60)
})
test('duplicate and invalid rows do not inflate results',()=>{
  const a=row('a',1000,100)
  assert.equal(accountTimeline([a,a,{...a,id:'bad',pnl:NaN}]).length,1)
})
test('highlight selection includes the biggest win and loss and stays bounded',()=>{
  const events=accountTimeline(Array.from({length:30},(_,i)=>row(String(i),i*1000,i===10?10000:i===20?-9000:10)))
  const highlights=accountHighlights(events)
  assert.ok(highlights.some(e=>e.id==='10'));assert.ok(highlights.some(e=>e.id==='20'));assert.ok(highlights.length<=6)
  assert.equal(events.at(-1).count,30)
})
test('simultaneous closures are counted together',()=>{
  const events=accountTimeline([row('a',1000,100),row('b',1000,-30)])
  assert.equal(accountSnapshot(events,1000).event.cumulative,70)
})
