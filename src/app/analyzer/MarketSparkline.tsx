import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ChartPoint } from '../types'
import { PickChart } from '../PickChart'

type ChartResult = { history: ChartPoint[]; error: boolean; end: number }
const cache = new Map<string, { expires: number; request: Promise<ChartResult> }>()
const WEEK = 7 * 24 * 60 * 60

async function loadUSHistory(slug: string, outcome: string, signal: AbortSignal) {
  const response = await fetch(`https://gateway.polymarket.us/v1/market/slug/${encodeURIComponent(slug)}`, { signal })
  if (!response.ok) throw new Error('Market unavailable')
  const { market } = await response.json()
  const sides: { team?: { name?: string }; description?: string; identifier?: string; long?: boolean }[] = market?.marketSides ?? []
  // Use the same label as the analyzer's US market normalization. A short
  // outcome has its own quote; it is not necessarily 1 minus the long price.
  const side = sides.find(side => (side.team?.name || side.description || side.identifier) === outcome)
  if (typeof side?.long !== 'boolean') throw new Error('Outcome unavailable')
  const historyResponse = await fetch(`https://gateway.polymarket.us/v1/price-history?symbol=${encodeURIComponent(slug)}&fixedInterval=INTERVAL_1W&fidelity=180`, { signal })
  if (!historyResponse.ok) throw new Error('History unavailable')
  const data = await historyResponse.json()
  if (!Array.isArray(data.history)) throw new Error('Invalid history')
  return { history: data.history.map((point: { timestamp: number; longPrice: number; shortPrice: number }) => ({
    t: point.timestamp, p: side.long ? point.longPrice : point.shortPrice,
  })) }
}

function loadHistory(slug: string, outcome: string, isUS: boolean) {
  const key = JSON.stringify([slug, outcome, isUS])
  const existing = cache.get(key)
  if (existing && existing.expires > Date.now()) return existing.request
  const request = (async (): Promise<ChartResult> => {
    const end = Math.floor(Date.now() / 1000)
    try {
      const signal = AbortSignal.timeout(25000)
      const { data, error } = isUS
        ? { data: await loadUSHistory(slug, outcome, signal), error: null }
        : await supabase.functions.invoke('price-chart', { body: { market_slug: slug, outcome }, signal })
      if (error || data?.error || !Array.isArray(data?.history)) throw new Error('Chart unavailable')
      const history = data.history.filter((point: ChartPoint) => point && Number.isFinite(point.t)
        && Number.isFinite(point.p) && point.p >= 0 && point.p <= 1 && point.t >= end - WEEK && point.t <= end)
        .sort((a: ChartPoint, b: ChartPoint) => a.t - b.t)
      return { history, error: false, end }
    } catch {
      cache.delete(key)
      return { history: [], error: true, end }
    }
  })()
  if (cache.size >= 150) cache.delete(cache.keys().next().value!)
  cache.set(key, { expires: Date.now() + 5 * 60 * 1000, request })
  return request
}

export function MarketSparkline({ url, outcome, price, initialHistory, accent, filled }: {
  url: string; outcome: string; price: number | null; initialHistory?: ChartPoint[]
  accent?: { line: string; bright: string }; filled?: boolean
}) {
  const container = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ChartResult | null>(null)
  const suppliedHistory = useMemo(() => (initialHistory ?? [])
    .filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p >= 0 && point.p <= 1)
    .sort((a, b) => a.t - b.t), [initialHistory])
  const useSuppliedHistory = attempt === 0 && suppliedHistory.length >= 2
  let slug: string | null = null
  let isUS = false
  try {
    const parsed = new URL(url)
    isUS = ['polymarket.us', 'www.polymarket.us'].includes(parsed.hostname)
    if (isUS || ['polymarket.com', 'www.polymarket.com'].includes(parsed.hostname)) {
      slug = parsed.pathname.match(/^\/market\/([a-zA-Z0-9_-]+)\/?$/)?.[1] ?? null
    }
  } catch { /* Unsupported links get an honest empty state. */ }

  useEffect(() => {
    if (useSuppliedHistory || !slug || !outcome) return
    let cancelled = false
    const load = () => { loadHistory(slug, outcome, isUS).then(data => { if (!cancelled) setResult(data) }) }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => { cancelled = true }
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      load()
    }, { rootMargin: '100px' })
    if (container.current) observer.observe(container.current)
    return () => { cancelled = true; observer.disconnect() }
  }, [slug, outcome, isUS, attempt, useSuppliedHistory])

  const retry = () => {
    cache.delete(JSON.stringify([slug, outcome, isUS]))
    setResult(null)
    setAttempt(value => value + 1)
  }

  const history = useSuppliedHistory ? suppliedHistory : !slug || !outcome ? [] : result?.history ?? null
  return <div className="ac-market-chart" ref={container}>
    <PickChart history={history}
      outcome={outcome} price={price ?? history?.at(-1)?.p ?? 0}
      error={!useSuppliedHistory && (!slug || !outcome || !!result?.error)} onRetry={retry} accent={accent} filled={filled} />
    <div className="expert-pick-chart-caption"><span title={outcome}>{outcome}</span><span>{useSuppliedHistory ? 'All time' : 'Past 7 days'}</span></div>
  </div>
}
