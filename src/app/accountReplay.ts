export type AccountTrade = {
  id: string; marketId: string; title: string; outcome: string
  closedAt: string; invested: number; pnl: number; image?: string | null
}
export type AccountEvent = AccountTrade & { time: number; cumulative: number; deployed: number; count: number; wins: number }
export function accountTimeline(trades: AccountTrade[]): AccountEvent[] {
  const sorted = trades.filter(t => Number.isFinite(Date.parse(t.closedAt)) && Number.isFinite(t.pnl) && Number.isFinite(t.invested) && t.invested >= 0)
    .slice().sort((a,b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || a.id.localeCompare(b.id))
  const seen = new Set<string>()
  let cumulative = 0, deployed = 0, count = 0, wins = 0
  return sorted.flatMap(t => {
    if (seen.has(t.id)) return []
    seen.add(t.id); cumulative += t.pnl; deployed += t.invested; count++; if (t.pnl > 0) wins++
    return [{ ...t, time: Date.parse(t.closedAt), cumulative, deployed, count, wins }]
  })
}
export function accountSnapshot(events: AccountEvent[], cursor: number) {
  let low = 0, high = events.length
  while (low < high) { const mid = (low + high) >>> 1; if (events[mid].time <= cursor) low = mid + 1; else high = mid }
  return { index: low - 1, event: events[low - 1] ?? null }
}
// Every trade affects P&L. Only a small set of notable results get logos.
export function accountHighlights(events: AccountEvent[], limit = 6): AccountEvent[] {
  if (!events.length) return []
  const selected = new Map<string, AccountEvent>()
  const bySize = [...events].sort((a,b) => Math.abs(b.pnl) - Math.abs(a.pnl))
  const win = bySize.find(t => t.pnl > 0), loss = bySize.find(t => t.pnl < 0)
  if (win) selected.set(win.id, win)
  if (loss) selected.set(loss.id, loss)
  const start = events[0].time, span = Math.max(1, events[events.length - 1].time - start)
  for (let bucket = 0; bucket < limit && selected.size < limit; bucket++) {
    const best = bySize.find(t => Math.min(limit - 1, Math.floor((t.time - start) / span * limit)) === bucket && !selected.has(t.id))
    if (best) selected.set(best.id, best)
  }
  return [...selected.values()].slice(0,limit).sort((a,b) => a.time - b.time)
}
