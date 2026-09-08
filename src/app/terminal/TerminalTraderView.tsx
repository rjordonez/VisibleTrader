import { useParams } from 'react-router-dom'
import TraderDetailPage from '../TraderDetailPage'
import { terminalPath } from '../../lib/domains'

// Reuse the trader data and widgets with the terminal summary/chart layout.
export default function TerminalTraderView() {
  const { wallet } = useParams<{ wallet: string }>()
  if (!wallet) return null
  return (
    <TraderDetailPage
      key={wallet}
      wallet={wallet}
      linkToTrader={w => terminalPath(`/trader/${w}`)}
      chartHeight={440}
      terminalLayout
    />
  )
}
