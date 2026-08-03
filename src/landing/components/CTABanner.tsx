import { useState } from 'react'

export default function CTABanner() {
  const [email, setEmail] = useState('')

  return (
    <div style={{ padding: '0 1.5rem 5rem' }}>
      <div className="cta-banner">
        <h2>Want to see what<br />top traders are buying?</h2>
        <p>Start free, track real Polymarket wallet activity, live, no credit card required.</p>
        <form
          className="cta-form"
          onSubmit={e => { e.preventDefault(); setEmail('') }}
        >
          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary">Get started free</button>
        </form>
      </div>
    </div>
  )
}
