import './landing.css'
import { Link } from 'react-router-dom'
import Footer from './components/Footer'

export default function TermsPage() {
  return (
    <>
      <div className="blog-content legal-content">
        <Link to="/" className="legal-back">← Back to home</Link>
        <h1 className="blog-title">Terms of Service</h1>
        <p className="blog-sub">Last updated: August 29, 2026</p>

        <p className="legal-notice">
          Please read carefully. These Terms include a binding arbitration agreement, a class action and jury
          trial waiver, an auto-renewal authorization, a limitation of liability, and a no-refund policy. You can
          opt out of arbitration within 30 days of first accepting these Terms (see Section 15).
        </p>

        <h2>1. Who we are and what you are agreeing to</h2>
        <p>
          These Terms of Service ("Terms") form a binding agreement between you and Revan Group LLC, a California
          limited liability company doing business as VisibleTrader ("VisibleTrader", "we", "us", or "our"). They govern your
          access to and use of visibletrader.com, the VisibleTrader app, and any related services, features, and
          content (together, the "Services"). By creating an account, clicking to accept, or using the Services,
          you agree to these Terms, our Privacy Policy, and our Refund Policy. If you do not agree, do not use the
          Services.
        </p>
        <p>
          We may update these Terms from time to time. The "Last updated" date will change and, for material
          changes, we will give you notice through the app or by email. Continued use after an update means you
          accept the new Terms. If you do not accept, stop using the Services and cancel any active subscription.
        </p>

        <h2>2. What VisibleTrader is (and is not)</h2>
        <p>
          VisibleTrader is a tracking and analytics tool that shows you public, on-chain trading activity from a
          roster of Polymarket wallets — live trades, closed positions, win rates, and profit/loss — along with
          browser alerts on your own watchlist. VisibleTrader is not a broker, dealer, exchange, futures commission
          merchant, designated contract market, money transmitter, investment adviser, financial planner, tax
          advisor, or law firm. We do not custody your funds, we do not hold or request any wallet or trading
          credentials from you, and we do not place, execute, or otherwise handle trades on your behalf.
        </p>
        <p>
          If you decide to act on anything you see in the Services, you do so entirely on your own Polymarket
          account, which you connect to and manage independently of VisibleTrader. We have no visibility into and
          no involvement in any trade you personally choose to make.
        </p>

        <h2>3. Eligibility, jurisdiction, and sanctions</h2>
        <p>
          To use the Services you must be at least 18 years old (or the age of majority where you live, if
          higher), have the legal capacity to enter into a contract, and be legally permitted to access prediction
          markets and any third-party platforms you use from your location. Prediction markets are restricted or
          prohibited in some jurisdictions. Confirming that your use is legal where you are is your
          responsibility, not ours.
        </p>
        <p>
          You may not use the Services if you are located in, ordinarily resident in, or a national of any country
          or region subject to comprehensive US sanctions, or if you are on any US government restricted party
          list (including OFAC's Specially Designated Nationals list). You agree to comply with all applicable
          export control and sanctions laws.
        </p>

        <h2>4. Not financial, legal, or tax advice</h2>
        <p>
          Everything the Services show you — tracked wallet activity, leaderboard rankings, profit/loss figures,
          and alerts — is provided for informational and educational purposes only. It reflects historical,
          publicly available on-chain data and is not financial, investment, legal, tax, or accounting advice, and
          it is not an offer, solicitation, or recommendation to buy or sell anything. Data can be delayed,
          incomplete, or inaccurate due to blockchain, API, or third-party platform issues. Prediction markets
          carry substantial risk and you can lose the entire amount you put in. Every bet, trade, and financial
          decision is yours alone. Past performance of any tracked wallet is not indicative of future results and
          is not indicative of what you personally would earn.
        </p>

        <h2>5. Your account and security</h2>
        <p>
          Accounts are created and signed in to through a third-party identity provider (such as Google or
          Apple) — we do not set or store a VisibleTrader password for you. You are responsible for keeping that
          third-party account secure and for all activity that occurs under your VisibleTrader account. Notify us
          immediately at visibletradehq@gmail.com if you suspect unauthorized access. We may require additional
          verification, refuse to open an account, or close an account at our discretion to the extent permitted
          by law.
        </p>

        <h2>6. Subscriptions, billing, auto-renewal, and price changes</h2>
        <p>
          Certain features require a paid subscription. Payments are processed by Stripe and Stripe's terms also
          apply. Prices are shown in the Services at checkout and are in US dollars unless stated otherwise. You
          are responsible for any taxes, duties, or currency conversion fees that apply to your purchase.
        </p>
        <p>
          <strong>Auto-renewal.</strong> Subscriptions renew automatically at the end of each billing period at
          the then-current price, using the payment method on file, until you cancel. You authorize us and our
          payment processor to charge you on a recurring basis without further authorization from you until you
          cancel.
        </p>
        <p>
          <strong>Cancellation.</strong> You can cancel anytime from Settings, from the Stripe customer portal, or
          by emailing visibletradehq@gmail.com. Cancellation stops future renewals. You keep access until the end
          of the current period and are not charged again after that. We do not prorate or refund partial periods.
          See our Refund Policy.
        </p>
        <p>
          <strong>Price changes.</strong> We may change subscription prices. If we do, the new price applies from
          your next renewal after we give you reasonable prior notice by email or in the app. If you do not agree,
          cancel before the renewal date.
        </p>
        <p>
          <strong>Introductory and promotional pricing.</strong> Any introductory price or promotional offer
          (such as a discounted first billing period) converts to the standard recurring subscription price
          automatically unless you cancel before it ends. Promotional and one-time offers may be limited to new
          customers and may not be combined with other offers.
        </p>
        <p>
          <strong>Failed payments.</strong> If a charge fails, we may retry, downgrade, suspend, or cancel your
          access. You are responsible for any bank or processor fees caused by a failed charge.
        </p>

        <h2>7. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Violate any law, regulation, court order, or third-party right</li>
          <li>Access accounts, systems, or data you are not authorized to access</li>
          <li>Reverse engineer, decompile, or scrape the Services at scale, or bulk-export their data</li>
          <li>Circumvent rate limits, authentication, paywalls, or other technical restrictions</li>
          <li>Resell, sublicense, share, or transfer your account or access</li>
          <li>Upload or transmit malware, exploit code, or content that is unlawful, infringing, harassing, or defamatory</li>
          <li>Use the Services to manipulate markets, engage in wash trading, self-dealing, front-running, market abuse, or fraud</li>
          <li>Interfere with the operation, security, or integrity of the Services</li>
        </ul>
        <p>
          We may investigate suspected violations and may suspend, restrict, or terminate accounts at our
          discretion.
        </p>

        <h2>8. Ownership and feedback</h2>
        <p>
          Our brand, software, UI, and content are owned by us or our licensors and are protected by intellectual
          property laws. Subject to these Terms and while your account is active and in good standing, we grant
          you a personal, limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access
          and use the Services for your personal use only, and not for resale, sublicensing, account sharing,
          scraping, or redistribution. You may use insights you get from the Services to make your own trading
          decisions; the license restriction is on the Services themselves, not on your personal financial
          activity.
        </p>
        <p>
          If you send us ideas, suggestions, or feedback, you grant us a perpetual, irrevocable, royalty-free,
          worldwide license to use them without any obligation to you.
        </p>

        <h2>9. DMCA and copyright</h2>
        <p>
          If you believe content on the Services infringes your copyright, send a notice to
          visibletradehq@gmail.com with (a) your contact info, (b) identification of the copyrighted work, (c) the
          URL or description of the allegedly infringing material, (d) a statement of good-faith belief that use
          is not authorized, (e) a statement under penalty of perjury that the information is accurate and you are
          authorized to act for the rights holder, and (f) your physical or electronic signature. We may remove
          the material and, in appropriate cases, terminate repeat infringers.
        </p>

        <h2>10. Third-party platforms</h2>
        <p>
          VisibleTrader is independent and not affiliated with Polymarket or any other prediction market,
          exchange, wallet, or payment provider. Their fees, outages, latency, market resolutions, chain reorgs,
          KYC decisions, account restrictions, and other actions are outside our control and are governed by their
          own terms and privacy policies. We are not responsible for anything a third party does or fails to do.
        </p>

        <h2>11. Beta features and changes to the Services</h2>
        <p>
          We may release features that are labeled beta, preview, experimental, or early access. They are
          provided as-is, may change or be removed without notice, and may not work as expected. We may add,
          modify, suspend, or discontinue any part of the Services at any time. We are not liable to you for any
          such change or discontinuation.
        </p>

        <h2>12. As-is; no warranties</h2>
        <p>
          To the fullest extent permitted by law, the Services and all content are provided "as is" and "as
          available" without warranties of any kind, whether express, implied, statutory, or otherwise. We
          disclaim all warranties including merchantability, fitness for a particular purpose, title,
          non-infringement, accuracy, availability, security, and uninterrupted or error-free operation.
        </p>

        <h2>13. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, in no event will VisibleTrader or Revan Group LLC be liable for any
          indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost
          revenue, lost data, business interruption, loss of goodwill, or losses from trading or any decision made
          using the Services, even if we have been advised of the possibility of such damages.
        </p>
        <p>
          Except where prohibited by law, our total aggregate liability for any and all claims arising out of or
          relating to these Terms or the Services is limited to the greater of (a) the amount you paid us in the
          three months immediately before the event giving rise to the claim, or (b) fifty US dollars ($50). Some
          jurisdictions do not allow certain limitations, so parts of this section may not apply to you. Nothing
          in these Terms limits liability that cannot be limited by law, including for gross negligence, willful
          misconduct, fraud, or death or personal injury caused by our negligence.
        </p>

        <h2>14. Indemnity</h2>
        <p>
          You will defend, indemnify, and hold harmless VisibleTrader and Revan Group LLC from and against any claim,
          loss, liability, damage, cost, and expense (including reasonable attorneys' fees) arising out of or
          related to (a) your use of the Services, (b) your bets or trades, (c) your breach of these Terms or any
          law, or (d) your violation of any third-party right. This does not apply to the extent a claim is caused
          by our own conduct.
        </p>

        <h2>15. Dispute resolution and arbitration</h2>
        <p>
          <strong>Informal resolution first.</strong> Before starting a formal claim, please email
          visibletradehq@gmail.com with a description of the issue and your contact info. We will try in good
          faith to resolve it within 60 days.
        </p>
        <p>
          <strong>Binding arbitration.</strong> If we cannot resolve it, you and VisibleTrader agree that any
          dispute, claim, or controversy arising out of or relating to these Terms or the Services will be
          resolved by final and binding individual arbitration administered by JAMS under its Streamlined
          Arbitration Rules, in the State of California, or by video at your request. The arbitrator (not any
          court) has exclusive authority to decide all issues including arbitrability. Judgment on the award may
          be entered in any court of competent jurisdiction. The Federal Arbitration Act governs this section.
        </p>
        <p>
          <strong>Class action and jury waiver.</strong> Disputes must be brought on an individual basis only.
          You and VisibleTrader waive the right to a jury trial and the right to participate as a plaintiff or
          class member in any class, collective, consolidated, or representative action. If this waiver is found
          unenforceable as to a particular claim, that claim (and only that claim) will proceed in court.
        </p>
        <p>
          <strong>Small claims.</strong> Either party may bring an individual action in small claims court instead
          of arbitration if it qualifies.
        </p>
        <p>
          <strong>30-day opt out.</strong> You may opt out of this arbitration agreement by emailing
          visibletradehq@gmail.com within 30 days of first accepting these Terms, with the subject "Arbitration
          Opt Out" and your account email. Opting out will not affect any other part of these Terms.
        </p>

        <h2>16. Governing law and venue</h2>
        <p>
          These Terms are governed by the laws of the State of California and the Federal Arbitration Act,
          without regard to conflict-of-laws rules. Any claim not subject to arbitration will be brought
          exclusively in the state or federal courts located in California, and you consent to personal
          jurisdiction there.
        </p>

        <h2>17. Termination</h2>
        <p>
          You can stop using the Services and cancel your subscription at any time. To the extent permitted by
          law, we may suspend, restrict, downgrade, or terminate your access, any feature, any account, or the
          Services as a whole, including for suspected violations of these Terms, suspected fraud or abuse,
          chargebacks or payment issues, legal or regulatory compliance, or security risk. Except where required
          by law, we are not required to provide a refund, credit, or continued access on termination or
          suspension, and unpaid subscription periods are not refundable. Sections that by their nature should
          survive termination (including Ownership, Disclaimers, Limitation of Liability, Indemnity, Dispute
          Resolution, Governing Law, and General) will survive.
        </p>

        <h2>18. Sole discretion and no obligations</h2>
        <p>
          Except where required by law, every decision we make about the Services is at our sole and absolute
          discretion, including whether to accept, keep, restrict, or close any account, and whether to offer,
          extend, honor, revoke, or modify any subscription plan, price, trial, discount, or promotion. Any
          refund, credit, or courtesy extension ever granted to any user is a one-time discretionary courtesy
          only and does not obligate us to offer the same to you or anyone else in the future.
        </p>

        <h2>19. No fiduciary or advisory relationship</h2>
        <p>
          Nothing in these Terms, the Services, or any communication from us creates a fiduciary, advisory,
          brokerage, agency, partnership, joint venture, or trust relationship between you and VisibleTrader. We
          do not act on your behalf and do not owe you any fiduciary or best-interest duty beyond what is
          expressly stated in these Terms and cannot be disclaimed under applicable law. Any information shown in
          the Services is general information, not personalized advice, and is not tailored to your
          circumstances, objectives, or risk tolerance.
        </p>

        <h2>20. Communications and notices</h2>
        <p>
          You consent to receive electronic communications from us at the email address on your account and
          through in-app notices. These communications satisfy any legal requirement that a communication be in
          writing. Notices to us must be sent to visibletradehq@gmail.com.
        </p>

        <h2>21. Force majeure</h2>
        <p>
          We are not liable for any failure or delay in performance caused by events beyond our reasonable
          control, including acts of God, natural disasters, war, civil unrest, government action, internet or
          infrastructure failures, blockchain outages, or third-party platform failures.
        </p>

        <h2>22. Assignment</h2>
        <p>
          You may not assign or transfer these Terms or your account without our prior written consent. We may
          assign these Terms in connection with a sale of the business or by operation of law.
        </p>

        <h2>23. General</h2>
        <p>
          If any provision of these Terms is held unenforceable, the rest will remain in effect. Our failure to
          enforce a right is not a waiver. These Terms, along with the Privacy Policy and Refund Policy, are the
          entire agreement between you and VisibleTrader regarding the Services and supersede any prior agreement
          on the same subject. Headings are for convenience only.
        </p>

        <h2>24. Contact</h2>
        <p>
          Revan Group LLC, doing business as VisibleTrader. Email visibletradehq@gmail.com. Our mailing address is
          available on request.
        </p>

        <div className="legal-links">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/refund-policy">Refund Policy</Link>
        </div>
      </div>
      <Footer />
    </>
  )
}
