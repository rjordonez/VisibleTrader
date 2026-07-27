import { useState } from 'react'

const faqs = [
  {
    q: 'How does VisibleTrader actually work?',
    a: 'VisibleTrader watches Polymarket\'s trade feed in real time and tracks a roster of top-performing wallets by realized profit. When one or more of those wallets buys into a market, it shows up in your dashboard — ranked by how much capital is behind it, with a live price chart marking exactly where each trader bought in.',
  },
  {
    q: 'Which platform does this cover?',
    a: "Polymarket only, right now. We'd rather do one platform well — with real wallet resolution, real trade attribution, and real price history — than claim broad coverage we can't back up.",
  },
  {
    q: 'Do you place trades for me?',
    a: "No. VisibleTrader is a tracking and analytics tool — it shows you what tracked wallets are doing, it does not execute trades on your behalf or manage funds. You place your own trades directly on Polymarket if you choose to.",
  },
  {
    q: 'Will I make money every single day?',
    a: "No, and anyone who tells you that is lying. Following a tracked wallet's activity is not a guarantee of profit — individual markets are uncertain, tracked wallets lose trades too, and past performance doesn't predict future results.",
  },
  {
    q: "How do I know this isn't a scam?",
    a: "Every number on the dashboard traces back to a real, public, on-chain Polymarket transaction — you can verify any of it yourself on Polygon. We don't publish fabricated results or cherry-picked screenshots.",
  },
  {
    q: 'What if I want to cancel?',
    a: "Cancel any time, no questions asked. We don't lock you into annual plans or charge cancellation fees.",
  },
]

const links = [
  { img: '/discord.png', label: 'Discord Community', arrow: true },
  { img: '/x-logo.jpg',  label: 'X / Twitter',       arrow: true },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section className="section" id="faq">
      <div className="section-inner">
        <div className="faq-two-col">

          {/* Left */}
          <div className="faq-left">
            <div className="faq-left-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="9" stroke="#818cf8" strokeWidth="1.5"/>
                <path d="M10 9v5M10 6.5v.5" stroke="#818cf8" strokeWidth="1.75" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="faq-left-heading">Sound too good<br />to be true?<br />Let us answer<br />your questions.</h2>
            <div className="faq-support-links">
              {links.map(l => (
                <a key={l.label} href="#" className="faq-support-link">
                  {l.img && <img src={l.img} alt={l.label} className="faq-support-logo" />}
                  {l.label}
                  {l.arrow && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 4 }}>
                      <path d="M2.5 9.5L9.5 2.5M9.5 2.5H4M9.5 2.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </a>
              ))}
            </div>
          </div>

          {/* Right */}
          <div className="faq-list">
            {faqs.map((f, i) => (
              <div key={i} className="faq-item">
                <button
                  className="faq-question"
                  onClick={() => setOpen(open === i ? null : i)}
                >
                  <svg
                    className={`faq-chevron ${open === i ? 'open' : ''}`}
                    width="16" height="16" viewBox="0 0 16 16" fill="none"
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {f.q}
                </button>
                {open === i && <div className="faq-answer">{f.a}</div>}
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  )
}
