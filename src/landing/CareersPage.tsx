import { Link } from 'react-router-dom'
import './landing.css'
import Footer from './components/Footer'

const jobs = [
  { slug: 'growth-intern', title: 'Growth Intern', team: 'Content', location: 'Remote' },
]

export default function CareersPage() {
  return (
    <>
      <div className="blog-content">
        <h1 className="blog-title">Careers at VisibleTrader</h1>
        <p className="blog-sub">Showing {jobs.length} job{jobs.length === 1 ? '' : 's'} of {jobs.length}</p>

        <div className="career-list">
          {jobs.map(j => (
            <Link to={`/careers/${j.slug}`} className="career-row" key={j.slug}>
              <div className="career-row-title">
                {j.title} <span className="career-row-team">· {j.team}</span>
              </div>
              <div className="career-row-right">
                <span className="career-row-location">{j.location}</span>
                <span className="career-row-apply">Apply now →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <Footer />
    </>
  )
}
