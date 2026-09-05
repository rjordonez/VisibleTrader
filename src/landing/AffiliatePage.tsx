import { useState } from 'react'
import { DollarSign, Rocket, MessageCircle, Tag, LifeBuoy, Bell } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './landing.css'
import Footer from './components/Footer'

const steps = [
  {
    n: 1,
    title: 'Apply',
    body: 'Tell us where you post and how to reach you. We review every application by hand and get back to you within a few business days. No minimum follower count required.',
  },
  {
    n: 2,
    title: 'Get your link',
    body: "Once approved, you get a unique referral link to drop in a bio, a post, or a video description — plus a heads up on new features and campaign ideas worth sharing.",
  },
  {
    n: 3,
    title: 'Start earning',
    body: 'Earn $10 for every trader who renews after their first discounted week. Paid out directly, with no cap on how many people you refer.',
  },
]

const benefits = [
  { Icon: DollarSign, title: 'Real Cash Payouts', body: '$10 per referral who sticks around past their first week. No points, no confusing tier math.' },
  { Icon: Rocket, title: 'Early Access', body: 'Try new features and pages before they ship to everyone else.' },
  { Icon: MessageCircle, title: 'Direct Line to the Team', body: "You're not a ticket number — reach the person actually building this." },
  { Icon: Tag, title: 'Your Own Promo Codes', body: "Give your audience a code that's tied to you, not a generic link." },
  { Icon: LifeBuoy, title: 'Priority Support', body: 'Anyone you refer jumps to the front of the support queue.' },
  { Icon: Bell, title: 'Insider Updates', body: "Hear what's coming before it's announced publicly." },
]

const faqs = [
  { q: 'How much can I earn as an affiliate?', a: 'You earn $10 for every trader who renews after their first discounted week. There is no cap on how many people you can refer.' },
  { q: 'Who can join the affiliate program?', a: 'Anyone with an audience that might be interested in Polymarket or prediction markets. No minimum follower count required.' },
  { q: 'How and when do I get paid?', a: "We'll coordinate payout details with you directly once your application is approved." },
  { q: 'What kind of support do affiliates get?', a: 'Priority support for anyone you refer, plus direct access to the team for questions, ideas, or campaign help.' },
  { q: 'Can I promote VisibleTrader on multiple platforms?', a: 'Yes — Instagram, TikTok, X, YouTube, a newsletter, wherever your audience actually is.' },
  { q: 'Is there a limit on referrals I can make?', a: 'No cap. Refer as many traders as you want.' },
  { q: 'How do I get approved to join?', a: 'Fill out the application below. We review every submission by hand and reply within a few business days.' },
  { q: 'Where can I find my affiliate link?', a: "We'll send it to you directly once you're approved — there's no dashboard to dig through beforehand." },
]

function ApplicationForm() {
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('saving')
    const { error } = await supabase.from('affiliate_applications').insert({ email, social_handle: handle || null })
    setStatus(error ? 'error' : 'done')
  }

  if (status === 'done') {
    return (
      <div className="aff-form-card">
        <div className="aff-form-done">Application received — we'll be in touch within a few business days.</div>
      </div>
    )
  }

  return (
    <form className="aff-form-card" onSubmit={submit}>
      <label className="aff-form-label">Email</label>
      <input
        className="calc-input" type="email" placeholder="you@example.com"
        value={email} onChange={e => setEmail(e.target.value)} required
      />
      <label className="aff-form-label">Instagram, TikTok, X — wherever you post</label>
      <input
        className="calc-input" type="text" placeholder="@yourhandle"
        value={handle} onChange={e => setHandle(e.target.value)}
      />
      <button type="submit" className="btn-primary aff-form-submit" disabled={status === 'saving'}>
        {status === 'saving' ? 'Submitting…' : 'Submit Application'}
      </button>
      {status === 'error' && <div className="aff-form-error">Something went wrong — try again in a moment.</div>}
    </form>
  )
}

function ReferralMock() {
  return (
    <div className="aff-mock">
      <div className="aff-mock-label">Your referral link</div>
      <div className="aff-mock-link">visibletrader.com/r/yourname</div>
      <div className="aff-mock-stats">
        <div className="aff-mock-stat">
          <div className="aff-mock-stat-label">Referrals</div>
          <div className="aff-mock-stat-val">—</div>
        </div>
        <div className="aff-mock-stat">
          <div className="aff-mock-stat-label">Earnings</div>
          <div className="aff-mock-stat-val">—</div>
        </div>
      </div>
      <div className="aff-mock-caption">What you'll get once approved — figures fill in as referrals come through.</div>
    </div>
  )
}

export default function AffiliatePage() {
  const scrollToApply = () => document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <div className="blog-content">
        <div className="aff-hero">
          <span className="aff-badge">Affiliate Program</span>
          <h1 className="blog-title">Turn your audience into income</h1>
          <p className="blog-sub" style={{ marginBottom: '1.5rem' }}>
            If your audience trades on Polymarket, or just likes watching real money move, send them to VisibleTrader and get paid when they stick around.
          </p>
          <button className="btn-primary" onClick={scrollToApply}>Apply now</button>
        </div>

        <h2 className="calc-section-title" style={{ marginBottom: '1.5rem' }}>How it Works</h2>
        <div className="aff-steps">
          {steps.map(s => (
            <div className="aff-step" key={s.n}>
              <div className="aff-step-n">{s.n}</div>
              <h3 className="aff-step-title">{s.title}</h3>
              <p className="aff-step-body">{s.body}</p>
              {s.n === 2 && <ReferralMock />}
              {s.n === 1 && (
                <div id="apply" style={{ marginTop: '1rem' }}>
                  <ApplicationForm />
                </div>
              )}
            </div>
          ))}
        </div>

        <h2 className="calc-section-title" style={{ margin: '3.5rem 0 1.5rem' }}>Why become a VisibleTrader affiliate?</h2>
        <div className="aff-benefits-grid">
          {benefits.map(b => (
            <div className="aff-benefit-card" key={b.title}>
              <b.Icon size={22} className="aff-benefit-icon" />
              <h3 className="aff-benefit-title">{b.title}</h3>
              <p className="aff-benefit-body">{b.body}</p>
            </div>
          ))}
        </div>

        <div className="calc-faq" style={{ marginTop: '3.5rem' }}>
          <h3 className="calc-section-title">Frequently Asked Questions</h3>
          <FAQ faqs={faqs} />
        </div>

        <div className="aff-cta">
          <div className="aff-cta-title">Ready to start earning?</div>
          <div className="aff-cta-sub">Join the traders and creators already earning with VisibleTrader.</div>
          <button className="btn-primary" onClick={scrollToApply}>Apply now</button>
        </div>
      </div>
      <Footer />
    </>
  )
}

function FAQ({ faqs: items }: { faqs: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="faq-list blog-answers-list">
      {items.map((f, i) => (
        <div key={i} className="faq-item">
          <button className="faq-question" onClick={() => setOpen(open === i ? null : i)}>
            <svg className={`faq-chevron ${open === i ? 'open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {f.q}
          </button>
          {open === i && <div className="faq-answer">{f.a}</div>}
        </div>
      ))}
    </div>
  )
}
