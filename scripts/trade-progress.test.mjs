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
