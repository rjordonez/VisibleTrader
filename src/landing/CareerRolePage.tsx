import { Link } from 'react-router-dom'
import './landing.css'

// Rendered inside CareerLayout's <Outlet> (see App.tsx's nested route) — no
// layout chrome of its own.
export default function CareerRolePage() {
  return (
    <>
        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About VisibleTrader</h3>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          VisibleTrader helps people see what top traders are doing on Polymarket. We're a small, remote team
          looking for creators to help spread the word.
        </p>

        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About the Role</h3>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          Create short-form videos about VisibleTrader using formats we provide. You'll work closely with a
          campaign manager who shares ideas, gives feedback, and helps you get started. Your focus is simple:
          make and post videos in your own voice.
        </p>

        <p className="aff-step-body career-label" style={{ marginBottom: '0.5rem' }}>You'll be responsible for:</p>
        <ul className="aff-step-body" style={{ margin: '0 0 1.5rem', paddingLeft: '1.25rem' }}>
          <li>Create and post 1-2 short-form videos a day on your TikTok and/or Instagram using our provided formats.</li>
          <li>Stay in touch with your campaign manager and use their feedback for your next videos.</li>
        </ul>

        <p className="aff-step-body career-label" style={{ marginBottom: '0.5rem' }}>We're looking for someone with:</p>
        <ul className="aff-step-body" style={{ margin: '0 0 1.5rem', paddingLeft: '1.25rem' }}>
          <li>Comfort on camera or with voiceover, and the ability to post consistently, 1-2 videos a day</li>
          <li>No prior UGC experience required, just a willingness to make and post content regularly</li>
        </ul>

        <p className="aff-step-body career-label" style={{ marginBottom: '0.5rem' }}>Nice to have:</p>
        <ul className="aff-step-body" style={{ margin: '0 0 1.5rem', paddingLeft: '1.25rem' }}>
          <li>An existing TikTok or Instagram following</li>
          <li>Interest or experience in finance, betting, trading, or a similar niche</li>
        </ul>

        <p className="aff-step-body" style={{ marginBottom: '2rem' }}>
          Earn $15 per video.
        </p>

        <Link className="career-apply-btn" to="/careers/growth-intern/apply">Apply for this Job</Link>
    </>
  )
}
