import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replayPnl, replayValue, replayBounds } from '../src/app/tradeProgressMath.ts'

const position = { size: 100, invested: 20, avgPrice: .2, curPrice: .7, pnl: 50 }
test('replay finishes at the source position snapshot', () => {
  assert.equal(replayPnl(position, .7), 50)
  assert.equal(replayValue(position, .7), 70)
})
test('price changes drive both position value and P&L', () => {
  assert.ok(Math.abs(replayPnl(position, .2)) < 1e-10)
  assert.ok(replayPnl(position, .1) < 0)
  assert.equal(replayValue(position, .1), 10)
})
test('source P&L adjustments are retained', () => {
  assert.equal(replayPnl({ ...position, pnl: 45 }, .7), 45)
})
test('missing size uses cost basis while explicit zero remains zero', () => {
  assert.equal(replayValue({ ...position, size: undefined }, .7), 70)
  assert.equal(replayValue({ ...position, size: 0 }, .7), 0)
})
test('scale grows using only supplied observations and handles empty/zero data', () => {
  const start = replayBounds([581])
  const peak = replayBounds([581, 1000, 10000])
  assert.ok(start.min < 581 && start.max > 581)
  assert.ok(peak.max > 10000 && peak.min <= 581)
  assert.ok(peak.max > start.max)
  assert.deepEqual(replayBounds([0]), { min: 0, max: 1 })
  assert.deepEqual(replayBounds([]), { min: 0, max: 1 })
})

test('closed win and loss exports end at the recorded realized result', () => {
  const won = { size: 100, invested: 20, avgPrice: .2, curPrice: 1, pnl: 80 }
  const lost = { ...won, curPrice: 0, pnl: -20 }
  assert.equal(replayPnl(won, 1), 80)
  assert.equal(replayValue(won, 1), 100)
  assert.equal(replayPnl(lost, 0), -20)
  assert.equal(replayValue(lost, 0), 0)
})
test('sold position ends at average exit proceeds, not later market price', () => {
  const size = 100, invested = 20, pnl = 15
  const exit = (invested + pnl) / size
  const closed = { size, invested, avgPrice: .2, curPrice: exit, pnl }
  assert.equal(replayPnl(closed, exit), pnl)
  assert.equal(replayValue(closed, exit), 35)
})
