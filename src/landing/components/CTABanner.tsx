import { Link } from 'react-router-dom'

export default function CTABanner() {
  return (
    <div className="cta-banner">
      <h2>Stop trading blind.</h2>
      <p>See every tracked wallet's next move, the moment it happens — first week just $1.</p>
      <Link to="/pricing" className="btn-primary cta-banner-btn">Get started</Link>
    </div>
  )
}
