import './landing.css'

// Rendered inside CareerLayout's <Outlet>.
export default function CareerApplyPage() {
  return (
    <>
      <p className="aff-step-body" style={{ marginBottom: '1.5rem' }}>
        Hey I'm Tavasya, one of the campaign managers for VisibleTrader. If you think you're a good fit, I'd love to talk to you :).
      </p>
      <a className="career-apply-btn" href="https://cal.com/tavasya-ganpati-oba84s/ugc-intro-call">
        Book a call here
      </a>
    </>
  )
}
