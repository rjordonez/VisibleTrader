export interface JournalGraphPoint {
  day: number
  cumulative: number
  daily: number
}

export interface JournalGraphEvent {
  date: string
  position: number
  amount: number
  label: string
  tradeIndex: number | null
}

export function journalEventPoints(year: number | null, month: number | null, events: JournalGraphEvent[], baselinePosition?: number) {
  const prefix = year === null ? '' : month === null ? `${year}-` : `${year}-${String(month + 1).padStart(2, '0')}-`
  const sorted = events.filter(event => event.date.startsWith(prefix) && Number.isFinite(event.amount) && Number.isFinite(event.position))
    .sort((a, b) => a.position - b.position)
  if (!sorted.length) return []
  let cumulative = 0
  return [
    { date: '', position: baselinePosition ?? (sorted[0].position > 1e10 ? sorted[0].position - 1 : 0), amount: 0, label: 'Start of period', tradeIndex: null, cumulative: 0 },
    ...sorted.map(event => ({ ...event, cumulative: cumulative += event.amount })),
  ]
}

// Stop at the last recorded result instead of projecting into future days.
export function journalGraphPoints(year: number, month: number, totals: ReadonlyMap<string, number>): JournalGraphPoint[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const days = new Map<number, number>()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (const [date, value] of totals) {
    const day = Number(date.slice(8))
    if (date.startsWith(prefix) && day >= 1 && day <= daysInMonth && Number.isFinite(value)) days.set(day, value)
  }
  if (!days.size) return []
  const points: JournalGraphPoint[] = [{ day: 0, cumulative: 0, daily: 0 }]
  let cumulative = 0
  for (let day = 1; day <= Math.max(...days.keys()); day++) {
    const daily = days.get(day) ?? 0
    cumulative += daily
    points.push({ day, cumulative, daily })
  }
  return points
}
