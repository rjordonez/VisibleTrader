import { useNavigate, useParams } from 'react-router-dom'
import TraderDetailPage from '../TraderDetailPage'
import { terminalPath } from '../../lib/domains'

// Reuses TraderDetailPage as-is (it's already fully self-contained styling —
// .sig-page/.sig-panel/etc, all loaded via app.css) instead of duplicating
// it — only difference from the AppShell usage is linkToTrader, so "jump to
// another wallet" and "similar traders" links stay inside the Terminal's
// own route tree instead of bouncing out to the main app's /trader/:wallet.
export default function TerminalTraderView() {
  const { wallet } = useParams<{ wallet: string }>()
  const navigate = useNavigate()
  if (!wallet) return null
  return (
    <TraderDetailPage
      key={wallet}
      wallet={wallet}
      onBack={() => navigate(-1)}
      linkToTrader={w => terminalPath(`/trader/${w}`)}
    />
  )
}
