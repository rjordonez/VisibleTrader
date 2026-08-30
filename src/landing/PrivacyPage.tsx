import './landing.css'
import { Link } from 'react-router-dom'
import Footer from './components/Footer'

export default function PrivacyPage() {
  return (
    <>
      <div className="blog-content legal-content">
        <Link to="/" className="legal-back">← Back to home</Link>
        <h1 className="blog-title">Privacy Policy</h1>
        <p className="blog-sub">Last updated: August 29, 2026</p>

        <h2>1. Who we are</h2>
        <p>
          This Privacy Notice for Revan Group LLC, doing business as VisibleTrader ("we", "us", or "our"), describes
          how and why we access, collect, store, use, disclose, and otherwise process ("process") your personal
          information when you use our services ("Services"), including when you:
        </p>
        <ul>
          <li>Visit our website at visibletrader.com or any other site of ours that links to this notice</li>
          <li>Create an account, sign in, or use the VisibleTrader app</li>
          <li>Request a profit estimate or otherwise give us your email to follow up with you</li>
          <li>Purchase a subscription or communicate with us for support or feedback</li>
        </ul>
        <p>
          Our mailing address is available on request by emailing visibletradehq@gmail.com.
        </p>

        <h2>2. The short version</h2>
        <p>
          We collect what we need to run VisibleTrader, keep it secure, comply with the law, and make it better.
          We do not sell your personal information for money, and we do not run third-party advertising pixels.
          Some analytics cookies may still qualify as "sharing" or "targeted advertising" under certain US state
          laws, even when no money changes hands. You can opt out any time — see Section 7.
        </p>

        <h2>3. What we collect</h2>
        <p><strong>Information you provide:</strong></p>
        <ul>
          <li>Account info: the name, email, and profile photo made available by your sign-in provider (Google or Apple) when you create an account</li>
          <li>Payment info: handled by Stripe. We receive limited billing details such as the last four digits of your card, brand, country, and transaction status. We never see your full card number or CVV</li>
          <li>Watchlist and alert preferences you configure inside the app</li>
          <li>Email address and estimate inputs, if you use the profit estimate tool before signing up</li>
          <li>Support communications and any info you include in them</li>
        </ul>
        <p><strong>Information we collect automatically:</strong></p>
        <ul>
          <li>Device and connection info: IP address, user agent, browser, operating system, language, and approximate location derived from IP</li>
          <li>Usage info: pages viewed, features used, timestamps, referrers, error and diagnostic logs</li>
          <li>Cookies, local storage, and analytics tooling (see Section 7)</li>
        </ul>
        <p><strong>Information from third parties:</strong></p>
        <ul>
          <li>Google or Apple, if you use them to sign in</li>
          <li>Stripe, for subscription and payment status</li>
          <li>Public blockchain data associated with the tracked wallets shown in the Services — this is publicly available on-chain data, not information about you</li>
        </ul>
        <p>
          We do not ask for, collect, or store any wallet address, private key, or trading credential belonging to
          you. VisibleTrader only reads publicly available on-chain activity from a roster of third-party
          wallets — it does not require you to connect a wallet of your own.
        </p>

        <h2>4. Why we use it</h2>
        <ul>
          <li><strong>Provide the Services:</strong> run your account, process payments, deliver alerts you've configured</li>
          <li><strong>Operate, secure, and improve:</strong> analytics, fraud and abuse prevention, debugging, product improvement</li>
          <li><strong>Marketing:</strong> promotional emails you can unsubscribe from at any time</li>
          <li><strong>Comply with law:</strong> tax and accounting, responding to lawful requests, sanctions screening</li>
        </ul>
        <p>
          If you are in the EEA, UK, or Switzerland, our legal basis for the above is, respectively: performance
          of a contract, our legitimate interests, your consent, and legal obligation. You can withdraw consent at
          any time by emailing visibletradehq@gmail.com. Withdrawing consent does not affect the lawfulness of
          processing before the withdrawal.
        </p>

        <h2>5. Automated decision-making</h2>
        <p>
          VisibleTrader surfaces historical, publicly available on-chain trading data and does not use automated
          decision-making that produces legal or similarly significant effects on you (for example, decisions
          about credit, employment, housing, or insurance). If we ever introduce automated decision-making of
          that kind, we will describe it here and provide the rights the law requires.
        </p>

        <h2>6. Who we share it with</h2>
        <p>
          We share personal information with service providers who process it on our behalf under written
          contracts. These include our cloud hosting and database provider (Supabase), payment processor
          (Stripe), and product analytics provider (PostHog). We may also disclose information: (a) to comply
          with law, court orders, or lawful requests; (b) to protect our rights, users, or the public; (c) to
          enforce our Terms; (d) in connection with a sale of the business; and (e) with your consent or at your
          direction. We do not sell your personal information for money.
        </p>

        <h2>7. Cookies, tracking, and your ad choices</h2>
        <p>
          We use cookies, local storage, and analytics tooling to keep you signed in, remember preferences,
          measure usage, secure the Services, and understand how features perform. We do not run third-party
          advertising pixels. Under CPRA and other US state privacy laws, some analytics data flows can still
          qualify as "sharing" or "targeted advertising" even when no money is exchanged.
        </p>
        <p>
          <strong>Do Not Sell or Share and Opt Out of Targeted Advertising:</strong> email
          visibletradehq@gmail.com with the subject "Do Not Sell or Share" and we will apply the opt-out to your
          account.
        </p>
        <p>
          <strong>Global Privacy Control:</strong> we recognize a valid GPC browser signal as an opt-out of sale
          and sharing.
        </p>

        <h2>8. Security</h2>
        <p>
          We use TLS in transit, access controls, and standard security practices. You are responsible for
          keeping your sign-in provider account secure. No service can promise absolute security. If a data
          breach affecting your personal information occurs, we will notify you and any regulator as required by
          applicable law.
        </p>

        <h2>9. How long we keep your data</h2>
        <p>
          These are our default retention periods. We may keep data longer where the law requires or shorter
          where you ask us to delete your account, unless we have a legal reason to keep it (for example, tax
          records).
        </p>
        <ul>
          <li>Account and profile: life of the account plus 30 days after deletion</li>
          <li>Payment and billing records: 7 years, to meet tax and accounting rules</li>
          <li>Support communications: 24 months</li>
          <li>Security and audit logs: 12 months</li>
        </ul>

        <h2>10. Your rights</h2>
        <p>If you are in California or another US state with a comprehensive privacy law, you can:</p>
        <ul>
          <li>Know what we collect, use, disclose, and share</li>
          <li>Delete your personal information</li>
          <li>Correct inaccurate personal information</li>
          <li>Receive a portable copy</li>
          <li>Opt out of sale, sharing, or targeted advertising (see Section 7)</li>
          <li>Non-discrimination for exercising your rights</li>
        </ul>
        <p>If you are in the EEA, the UK, or Switzerland, you can:</p>
        <ul>
          <li>Access, rectification, erasure, restriction, portability, and objection</li>
          <li>Withdraw consent at any time where processing is based on consent</li>
          <li>Lodge a complaint with your local supervisory authority</li>
        </ul>
        <p>
          To exercise any of these rights, email visibletradehq@gmail.com from the email address on your account.
          We will verify your identity and respond within the timeframe required by applicable law. We do not
          charge a fee unless a request is manifestly unfounded or excessive.
        </p>

        <h2>11. Third-party platforms</h2>
        <p>
          We link to and integrate with third-party platforms such as Polymarket, Google, Apple, and Stripe.
          Their privacy practices are their own. Please review their policies before you use them.
        </p>

        <h2>12. Children</h2>
        <p>
          VisibleTrader is for adults only and is not directed to children under 18. We do not knowingly collect
          personal information from anyone under 18. If you believe a minor has provided us with personal
          information, email us and we will delete the account and the information.
        </p>

        <h2>13. Updates to this policy</h2>
        <p>
          We may update this policy from time to time. The latest version will always be on this page and the
          "Last updated" date will reflect the change. For material changes we will provide reasonable notice
          through the Services or by email. Continued use after a change means you accept the updated policy.
        </p>

        <h2>14. Contact</h2>
        <p>
          Questions about your data or this policy? Email visibletradehq@gmail.com.
        </p>

        <div className="legal-links">
          <Link to="/terms">Terms of Service</Link>
          <Link to="/refund-policy">Refund Policy</Link>
        </div>
      </div>
      <Footer />
    </>
  )
}
