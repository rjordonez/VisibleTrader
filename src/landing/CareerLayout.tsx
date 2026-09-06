import { Link, useLocation } from 'react-router-dom'

const META = [
  { label: 'Location', value: 'Remote' },
  { label: 'Employment Type', value: 'Contractor' },
  { label: 'Location Type', value: 'Remote' },
  { label: 'Department', value: 'Content' },
  { label: 'Compensation', value: 'Paid per video (CPM)' },
]

// Shared by CareerRolePage (Overview tab) and CareerApplyPage (Application
// tab) — same left metadata rail and tab nav either way, only the right-side
// content differs.
export default function CareerLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const isApply = pathname.endsWith('/apply')

  return (
    <div className="blog-content career-detail">
      <Link to="/careers" className="career-back">← All roles</Link>
      <h1 className="blog-title" style={{ marginBottom: '2rem' }}>Growth Intern</h1>

      <div className="career-layout">
        <aside className="career-sidebar">
          {META.map(m => (
            <div className="career-meta" key={m.label}>
              <div className="career-meta-label">{m.label}</div>
              <div className="career-meta-value">{m.value}</div>
            </div>
          ))}
        </aside>

        <div className="career-main">
          <div className="career-tabs">
            <Link to="/careers/growth-intern" className={`career-tab ${!isApply ? 'active' : ''}`}>Overview</Link>
            <Link to="/careers/growth-intern/apply" className={`career-tab ${isApply ? 'active' : ''}`}>Application</Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
