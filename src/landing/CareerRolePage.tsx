import { Link } from 'react-router-dom'
import './landing.css'
import Footer from './components/Footer'
import CareerLayout from './CareerLayout'

export default function CareerRolePage() {
  return (
    <>
      <CareerLayout>
        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About VisibleTrader</h3>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          VisibleTrader tracks the wallets of the best traders on Polymarket in real time, so anyone can see what
          they're doing and copy the moves that work. VisibleTrader spun out of Techstars, built by founder Rex
          Ordonez, and is growing fast.
        </p>

        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About the Team</h3>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          VisibleTrader's creator program is brand new. Right now it's the founder and whoever we bring on to help
          grow it. You'd be one of the first people building it out, not stepping into something already set in stone.
        </p>

        <h3 className="aff-step-title" style={{ marginBottom: '0.5rem' }}>About the Role</h3>
        <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
          You'll be one of the first people making UGC content about VisibleTrader, and helping figure out what
          actually converts along the way.
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
          Paid per video via CPM, no base salary, no cap. The more your content performs, the more you make.
        </p>

        <Link className="career-apply-btn" to="/careers/growth-intern/apply">Apply for this Job</Link>
      </CareerLayout>
      <Footer />
    </>
  )
}
