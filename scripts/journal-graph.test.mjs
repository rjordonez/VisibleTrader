import { test } from 'node:test'
import assert from 'node:assert/strict'
import { journalGraphPoints } from '../src/app/journalGraph.ts'

test('cumulative results include losses and carry forward gaps', () => {
  const points = journalGraphPoints(2026, 9, new Map([['2026-10-03', -40], ['2026-10-01', 100]]))
  assert.deepEqual(points, [
    { day: 0, daily: 0, cumulative: 0 },
    { day: 1, daily: 100, cumulative: 100 },
    { day: 2, daily: 0, cumulative: 100 },
    { day: 3, daily: -40, cumulative: 60 },
  ])
})
test('empty months remain empty; recorded zero results are retained', () => {
  assert.deepEqual(journalGraphPoints(2026, 9, new Map()), [])
  assert.equal(journalGraphPoints(2026, 9, new Map([['2026-10-01', 0]])).at(-1).cumulative, 0)
})
test('only valid days and finite results from the selected month are used', () => {
  const points = journalGraphPoints(2024, 1, new Map([['2024-02-29', 10], ['2024-03-01', 500], ['2024-02-30', 200], ['2024-02-01', NaN]]))
  assert.equal(points.at(-1).day, 29)
  assert.equal(points.at(-1).cumulative, 10)
  assert.equal(journalGraphPoints(2025, 1, new Map([['2025-02-29', 10]])).length, 0)
})

test('each trade has a chronological point, including entries without realized P&L', async () => {
  const { journalEventPoints } = await import('../src/app/journalGraph.ts')
  const points = journalEventPoints(2026, 9, [
    {date:'2026-10-01',position:1.8,amount:-20,label:'Loss',tradeIndex:1},
    {date:'2026-10-01',position:1.3,amount:100,label:'Win',tradeIndex:0},
    {date:'2026-10-01',position:1.9,amount:0,label:'Open trade',tradeIndex:2},
    {date:'2026-10-01',position:1.99,amount:30,label:'Manual entry',tradeIndex:null},
    {date:'2026-11-01',position:1,amount:500,label:'Other month',tradeIndex:3},
  ])
  assert.deepEqual(points.map(p=>p.cumulative),[0,100,80,80,110])
  assert.deepEqual(points.slice(1).map(p=>p.tradeIndex),[0,1,2,null])
})
