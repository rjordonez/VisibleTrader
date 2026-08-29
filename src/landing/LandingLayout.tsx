import { Outlet } from 'react-router-dom'
import Navbar from './components/Navbar'
import ProofWidget from './components/ProofWidget'
import PromoBanner from './components/PromoBanner'
import './landing.css'

export default function LandingLayout() {
  return (
    <div className="landing">
      <PromoBanner />
      <Navbar />
      <Outlet />
      <ProofWidget />
    </div>
  )
}
