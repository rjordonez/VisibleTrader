import { Link } from 'react-router-dom'
import './landing.css'

// Rendered inside CareerLayout's <Outlet> (see App.tsx's nested route) — no
// layout chrome of its own.
export default function CareerRolePage() {
  return (
    <>
        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About VisibleTrader</h3>
        <p className="aff-step-body" style={{ marginBottom: '1rem' }}>
          VisibleTrader's mission is to make prediction markets transparent: track the wallets of the best traders on
          Polymarket in real time, so anyone can see exactly what they're doing and copy the moves that work.
          VisibleTrader was built by founder Rex Ordonez, a Techstars alum, and is growing fast toward becoming the
          largest prediction market data platform there is.
        </p>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          Real startup culture: small team, fast decisions, direct access to the founder. We work remotely, ship
          constantly, and are only now building out the creator program from scratch.
        </p>

        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About the Role</h3>
        <p className="aff-step-body" style={{ marginBottom: '1rem' }}>
          As a creator on the Growth team, you'll bring your own voice and format to VisibleTrader's biggest wins and
          sharpest trades, turning real trading activity into short-form content that actually converts viewers into
          signups. You'd be one of the first people on the creator side, helping shape it from the ground up rather
          than stepping into something already set in stone.
        </p>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          This is a high-impact, hands-on role at the intersection of content creation and growth. You'll test hooks,
          formats, and calls-to-action, and see exactly which ones drive real signups, not just views.
        </p>

        <p className="aff-step-body career-label" style={{ marginBottom: '0.5rem' }}>You'll be responsible for:</p>
        <ul className="aff-step-body" style={{ margin: '0 0 1.5rem', paddingLeft: '1.25rem' }}>
          <li><b>Content Creation.</b> Post 1-2 short-form videos a day about VisibleTrader on your own TikTok and/or Instagram. Bring your own hooks, voice, and style, no script, no corporate tone. Include a clear call-to-action for VisibleTrader in every video so it counts toward payout.</li>
          <li><b>Performance & Iteration.</b> Track which videos actually drive signups, not just views. Double down on the hooks and formats that convert. Learn what works from real data instead of guessing.</li>
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
          Paid per video via CPM, no base salary. The more your content performs, the more you make.
        </p>

        <Link className="career-apply-btn" to="/careers/growth-intern/apply">Apply for this Job</Link>
    </>
  )
}
