import { useEffect, useState } from 'react'
import { fetchMarketChart } from './helpers'
import { TradeProgressModal, type PositionExportData } from './TradeProgressModal'

export function PositionProgressExport({ name, wallet, trade, onClose }: { name: string; wallet: string; trade: PositionExportData; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ points: { d: string; cum: number }[]; image: string | null; error: boolean; attempt: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchMarketChart(trade.conditionId, trade.outcome).then(data => {
      if (cancelled) return
      setResult({ points: data.history.filter(p => Number.isFinite(p.t) && Number.isFinite(p.p) && p.p >= 0 && p.p <= 1).map(p => ({ d: new Date(p.t * 1000).toISOString(), cum: p.p })), image: data.image, error: data.error, attempt })
    })
    return () => { cancelled = true }
  }, [trade.conditionId, trade.outcome, attempt])
  const loading = !result || result.attempt !== attempt
  return <TradeProgressModal name={name} wallet={wallet} trade={{ ...trade, image: result?.image }} points={loading ? [] : result.points}
    loading={loading} loadError={!loading && result.error} onRetry={() => setAttempt(a => a + 1)} onClose={onClose} />
}
