import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProofWidget from './components/ProofWidget'
import PromoBanner from './components/PromoBanner'
import './landing.css'

export default function LandingLayout() {
  // The rotating "someone just won" popup is a homepage sales-momentum
  // device — out of place on a content page like the blog, so it's
  // skipped there rather than gated per-route from inside the widget
  // itself.
  const { pathname } = useLocation()
  const showProofWidget = !pathname.startsWith('/blog')

  return (
    <div className="landing">
      <PromoBanner />
      <Navbar />
      <Outlet />
      {showProofWidget && <ProofWidget />}
    </div>
  )
}
