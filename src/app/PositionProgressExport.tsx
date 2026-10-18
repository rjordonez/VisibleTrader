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
      setResult({ points: data.history.filter(p => Number.isFinite(p.t) && Number.isFinite(p.p) && p.p >= 0 && p.p <= 1 && (!trade.closedAt || p.t * 1000 <= Date.parse(trade.closedAt))).map(p => ({ d: new Date(p.t * 1000).toISOString(), cum: p.p })), image: data.image, error: data.error, attempt })
    })
    return () => { cancelled = true }
  }, [trade.conditionId, trade.outcome, trade.closedAt, attempt])
  const loading = !result || result.attempt !== attempt
  // Older resolved markets can have no remaining provider history. Keep
  // their final result exportable without inventing a historical price curve.
  const snapshotOnly = !loading && !!trade.closedAt && (result.error || result.points.length < 2)
  const closedTime = Date.parse(trade.closedAt ?? '')
  const displayPoints = snapshotOnly
    ? [{ d: new Date(closedTime - 1000).toISOString(), cum: trade.curPrice }, { d: new Date(closedTime).toISOString(), cum: trade.curPrice }]
    : loading ? [] : result.points
  return <TradeProgressModal name={name} wallet={wallet} trade={{ ...trade, image: result?.image, historyUnavailable: snapshotOnly }} points={displayPoints}
    loading={loading} loadError={!loading && result.error && !snapshotOnly} onRetry={() => setAttempt(a => a + 1)} onClose={onClose} />
}
