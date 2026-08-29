import './landing.css'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { faqs } from './faqData'
import Footer from './components/Footer'

type Tab = 'blog' | 'learn' | 'answers'

const tabLabels: Record<Tab, string> = {
  blog: 'VisibleTrader',
  learn: 'Learn',
  answers: 'Answers',
}

export default function BlogPage() {
  const [tab, setTab] = useState<Tab>('blog')
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const visibleFaqs = faqs.filter(f =>
    f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <>
    <div className="blog-content">
      <div className="blog-breadcrumb">
        <Link to="/">Home</Link>
        <span>›</span>
        <Link to="/blog" onClick={() => setTab('blog')}>Blog</Link>
        {tab !== 'blog' && (
          <>
            <span>›</span>
            <span className="blog-breadcrumb-current">{tabLabels[tab]}</span>
          </>
        )}
      </div>

      <div className="blog-tabs">
        <button type="button" className={`blog-tab ${tab === 'blog' ? 'active' : ''}`} onClick={() => setTab('blog')}>VisibleTrader</button>
        <button type="button" className={`blog-tab ${tab === 'learn' ? 'active' : ''}`} onClick={() => setTab('learn')}>Learn</button>
        <button type="button" className={`blog-tab ${tab === 'answers' ? 'active' : ''}`} onClick={() => setTab('answers')}>Answers</button>
      </div>

      {tab === 'blog' && (
        <>
          <h1 className="blog-title">The VisibleTrader Blog</h1>
          <p className="blog-sub">Updates from the VisibleTrader team</p>
          <div className="blog-empty">No posts yet — check back soon.</div>
        </>
      )}

      {tab === 'learn' && (
        <>
          <h1 className="blog-title">Learn</h1>
          <p className="blog-sub">Guides on tracking wallets and reading the tape</p>
          <div className="blog-empty">No guides yet — check back soon.</div>
        </>
      )}

      {tab === 'answers' && (
        <>
          <h1 className="blog-title">Questions and Answers</h1>
          <p className="blog-sub">Answers to your VisibleTrader questions</p>

          <div className="blog-search">
            <input
              type="text"
              placeholder="Search articles"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Search size={18} />
          </div>

          <div className="faq-list blog-answers-list">
            {visibleFaqs.map((f, i) => (
              <div key={f.q} className="faq-item">
                <button
                  type="button"
                  className="faq-question"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <svg
                    className={`faq-chevron ${openFaq === i ? 'open' : ''}`}
                    width="16" height="16" viewBox="0 0 16 16" fill="none"
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {f.q}
                </button>
                {openFaq === i && <div className="faq-answer">{f.a}</div>}
              </div>
            ))}
            {visibleFaqs.length === 0 && <div className="blog-empty">No questions match "{search}".</div>}
          </div>
        </>
      )}
    </div>
    <Footer />
    </>
  )
}
