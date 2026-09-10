import { useState } from 'react'
import ProfitBot from './ProfitBot'
import AllMarkets from './AllMarkets'
import './profits.css'

function ProfitsPage() {
  const [view, setView] = useState<'bot' | 'markets'>('bot')
  return (
    <div className="sig-page profits-page">
      <header className="app-section-header">
        <div>
          <h1 className="app-section-title">Profits</h1>
          <p className="app-section-sub">
            {view === 'bot'
              ? 'A backtested, rules-based strategy built on every tracked trader.'
              : 'Every open market a tracked trader holds. Browse and filter — an overview, not a recommendation.'}
          </p>
        </div>
      </header>

      <div className="sig-seg" role="tablist" aria-label="Profits view">
        <button type="button" role="tab" aria-selected={view === 'bot'}
          className={view === 'bot' ? 'sig-seg-btn active' : 'sig-seg-btn'}
          onClick={() => setView('bot')}>Profit Bot</button>
        <button type="button" role="tab" aria-selected={view === 'markets'}
          className={view === 'markets' ? 'sig-seg-btn active' : 'sig-seg-btn'}
          onClick={() => setView('markets')}>All markets</button>
      </div>

      {view === 'bot' ? <ProfitBot /> : <AllMarkets />}
    </div>
  )
}

export default ProfitsPage
