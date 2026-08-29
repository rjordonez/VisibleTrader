import './landing.css'
import { Link } from 'react-router-dom'
import Footer from './components/Footer'

export default function RefundPage() {
  return (
    <>
      <div className="blog-content legal-content">
        <Link to="/" className="legal-back">← Back to home</Link>
        <h1 className="blog-title">Refund Policy</h1>
        <p className="blog-sub">Last updated: August 29, 2026</p>

        <h2>Who we are</h2>
        <p>
          This Refund Policy for Rex Ordonez, doing business as VisibleTrader ("we", "us", or "our"), explains
          how refunds work when you subscribe to our services ("Services"). By subscribing you agree to this
          policy along with our Terms of Service and Privacy Policy.
        </p>

        <h2>All sales final</h2>
        <p>
          VisibleTrader is a digital subscription that gives you instant access to live wallet tracking, alerts,
          and other premium features the moment your payment goes through. Because delivery is immediate, and
          except where required by law, all payments are non-refundable. By subscribing you expressly agree that
          performance begins immediately, you waive any statutory cooling-off or withdrawal right where waiver is
          permitted, and you accept that, except where required by law, no refunds will be issued for unused
          time, unused features, or change of mind.
        </p>

        <h2>How to cancel</h2>
        <p>
          You can cancel anytime from Settings, from the Stripe customer portal, or by emailing
          visibletradehq@gmail.com. Cancellation stops future renewals. You keep premium access until the end of
          your current billing period and you will not be charged again. Except where required by law, we do not
          prorate or refund partial or unused days.
        </p>

        <h2>Introductory and promotional pricing</h2>
        <p>
          Any introductory or promotional price converts to the standard recurring subscription price
          automatically at the end of the promo period unless you cancel first. Promotional and one-time offers
          may be limited to new customers, cannot be combined with other offers unless we say so, and are also
          non-refundable once redeemed.
        </p>

        <h2>Trading losses</h2>
        <p>
          VisibleTrader is an information tool. Except where required by law, we do not refund or compensate any
          losses from your own bets, trades, or financial decisions, including anything based on data or alerts
          shown in the Services. Every trade and every bet is your decision and your responsibility. Tracked
          wallet performance is never a guarantee of your own returns and can lead to total loss.
        </p>

        <h2>Bugs and outages</h2>
        <p>
          If something breaks, email us and we will work quickly to fix it. Bugs, downtime, service
          interruptions, feature changes, feature removals, third-party outages, and changes to Polymarket or any
          integrated platform do not qualify for a refund and do not entitle you to any credit, extension,
          compensation, or continued access, except where required by law.
        </p>

        <h2>Discretionary courtesies and equal treatment</h2>
        <p>
          Any refund, partial refund, credit, extension, discount, or one-time exception we ever grant is a
          discretionary courtesy only. It is not an admission of fault, does not modify this policy or our Terms
          of Service, is not a precedent, and does not obligate us to offer the same or similar treatment to you
          or to any other user, whether or not their situation appears similar. We apply this policy uniformly
          and reserve the right to decline any request without explanation, to the extent permitted by law.
        </p>

        <h2>Billing errors</h2>
        <p>
          If you were charged in error (for example, duplicate charges or a charge after a confirmed
          cancellation), email visibletradehq@gmail.com within 60 days of the charge with the transaction details
          and we will refund the erroneous amount. Requests submitted after 60 days may not be honored.
        </p>

        <h2>Chargebacks</h2>
        <p>
          If a charge looks wrong, please email us first so we can resolve it. Filing a chargeback or payment
          dispute without contacting us may result in immediate suspension or termination of your account and a
          permanent ban from future purchases. We reserve the right to recover disputed amounts and reasonable
          costs to the extent permitted by law.
        </p>

        <h2>EU, UK, and other statutory rights</h2>
        <p>
          If you are a consumer in the EU or UK, you would normally have a 14-day right of withdrawal for online
          purchases. By starting to use the paid Services immediately after checkout, you expressly request
          immediate performance of the contract and acknowledge that you lose that right of withdrawal once
          performance has begun, to the extent permitted by law. Nothing in this policy limits any non-waivable
          consumer rights you have under your local law. If a mandatory right applies to you, email us with the
          details and we will honor it.
        </p>

        <h2>Taxes</h2>
        <p>
          Prices exclude any applicable taxes, duties, or bank fees unless clearly stated otherwise. Any taxes we
          are required to collect will be shown at checkout or on your receipt. Refunds, where issued, are net of
          any non-recoverable taxes or fees.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          We may update this Refund Policy from time to time. The latest version will always be on this page.
          Continued use of the Services after an update means you accept the change.
        </p>

        <h2>Contact</h2>
        <p>Questions or issues? Email visibletradehq@gmail.com and we will get back to you.</p>

        <div className="legal-links">
          <Link to="/terms">Terms of Service</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </div>
      </div>
      <Footer />
    </>
  )
}
