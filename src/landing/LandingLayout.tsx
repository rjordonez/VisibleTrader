import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import PromoBanner from './components/PromoBanner'
import './landing.css'

export default function LandingLayout() {
  // The $1-first-week countdown banner is a homepage sales-momentum device,
  // out of place on every other marketing page (blog, careers, affiliates,
  // pricing, etc.), so it only shows on the homepage itself.
  const { pathname } = useLocation()
  const isHomepage = pathname === '/'

  return (
    <div className="landing">
      {isHomepage && <PromoBanner />}
      <Navbar />
      <Outlet />
    </div>
  )
}
