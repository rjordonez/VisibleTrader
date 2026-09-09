import ProfitBot from './ProfitBot'
import './profits.css'

function ProfitsPage() {
  return (
    <div className="sig-page profits-page">
      <header className="app-section-header">
        <div>
          <h1 className="app-section-title">Profits</h1>
          <p className="app-section-sub">A rules-based strategy built on every tracked trader.</p>
        </div>
      </header>
      <ProfitBot />
    </div>
  )
}

export default ProfitsPage
