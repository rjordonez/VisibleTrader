import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import type { Opportunity } from './types'
import { MarketDetailContent } from './MarketDetailContent'
import { SkelBlock } from './Skeleton'

// Full-page version of the market popup: the popup is a quick preview and
// "See more" lands here for activity and every contributing trader. The
// popup hands over the opportunity it already has via router state; a
// direct or shared link looks it up instead, same as the Terminal does.
export default function MarketPage({ conditionId, outcome }: { conditionId: string; outcome: string }) {
  const navigate = useNavigate()
  const passed = (useLocation().state as { opportunity?: Opportunity } | null)?.opportunity
  const handedOver = passed && passed.condition_id === conditionId && passed.outcome === outcome ? passed : null
  const [fetched, setFetched] = useState<Opportunity | null>(null)
  const [lookupDone, setLookupDone] = useState(false)

  useEffect(() => {
    if (handedOver) return
    let cancelled = false
    Promise.resolve(
      supabase.from('opportunities_live').select('*')
        .eq('condition_id', conditionId).eq('outcome', outcome)
        .maybeSingle()
    ).then(({ data }) => {
      if (!cancelled) setFetched((data as Opportunity | null) ?? null)
    }).finally(() => {
      if (!cancelled) setLookupDone(true)
    })
    return () => { cancelled = true }
  }, [handedOver, conditionId, outcome])

  const opportunity = handedOver ?? fetched
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate(dashboardPath('/')))

  return (
    <div className="sig-page mkt-page">
      <button type="button" className="mkt-page-back" onClick={goBack}>
        <ChevronLeft size={16} strokeWidth={2.5} /> Back
      </button>
      <div className="sig-panel mkt-page-panel">
        {opportunity ? (
          <MarketDetailContent opportunity={opportunity} chartVariant="minimal" chartHeight={280} />
        ) : !lookupDone ? (
          <SkelBlock height={420} />
        ) : (
          <div className="terminal-empty-sub" style={{ maxWidth: 'none' }}>
            This market isn't in the tracked-trader dataset anymore, or the link is stale.
          </div>
        )}
      </div>
    </div>
  )
}
