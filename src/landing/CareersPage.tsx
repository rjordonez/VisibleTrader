import './landing.css'
import Footer from './components/Footer'

export default function CareersPage() {
  return (
    <>
      <div className="blog-content">
        <h1 className="blog-title">Careers</h1>
        <p className="blog-sub">Join the team building VisibleTrader</p>
        <div className="blog-empty">No open positions right now — check back soon.</div>
      </div>
      <Footer />
    </>
  )
}
