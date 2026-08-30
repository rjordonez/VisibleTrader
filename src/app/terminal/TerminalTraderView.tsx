import { useParams } from 'react-router-dom'
import TraderDetailPage from '../TraderDetailPage'
import { terminalPath } from '../../lib/domains'

// Reuses TraderDetailPage as-is (it's already fully self-contained styling —
// .sig-page/.sig-panel/etc, all loaded via app.css) instead of duplicating
// it — only difference from the AppShell usage is linkToTrader, so "jump to
// another wallet" and "similar traders" links stay inside the Terminal's
// own route tree instead of bouncing out to the main app's /trader/:wallet.
export default function TerminalTraderView() {
  const { wallet } = useParams<{ wallet: string }>()
  if (!wallet) return null
  return (
    <TraderDetailPage
      key={wallet}
      wallet={wallet}
      linkToTrader={w => terminalPath(`/trader/${w}`)}
      chartHeight={400}
    />
  )
}
