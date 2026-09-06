import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProofWidget from './components/ProofWidget'
import PromoBanner from './components/PromoBanner'
import './landing.css'

export default function LandingLayout() {
  // The rotating "someone just won" popup and the $1-first-week countdown
  // banner are both homepage sales-momentum devices — out of place on every
  // other marketing page (blog, careers, affiliates, pricing, etc.), so
  // both only show on the homepage itself rather than being gated per-route
  // from inside the widgets.
  const { pathname } = useLocation()
  const isHomepage = pathname === '/'

  return (
    <div className="landing">
      {isHomepage && <PromoBanner />}
      <Navbar />
      <Outlet />
      {isHomepage && <ProofWidget />}
    </div>
  )
}
