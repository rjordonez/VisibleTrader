import { useEffect } from 'react'
import type { Opportunity } from './types'
import { MarketDetailContent } from './MarketDetailContent'

export function SignalModal({ opportunity: o, onClose }: { opportunity: Opportunity; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="sig-modal-backdrop" onClick={onClose}>
      <div className="sig-modal-wrap" onClick={e => e.stopPropagation()}>
        <button className="sig-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sig-modal">
          <MarketDetailContent opportunity={o} />
        </div>
      </div>
    </div>
  )
}
