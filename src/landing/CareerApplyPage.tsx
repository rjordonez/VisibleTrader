import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './landing.css'

// Rendered inside CareerLayout's <Outlet> (see App.tsx's nested route) — no
// layout chrome of its own.

const MAX_RESUME_BYTES = 5 * 1024 * 1024 // 5MB
const ACCEPTED_RESUME_TYPES = '.pdf,.doc,.docx'

const HEARD_ABOUT_OPTIONS = ['Instagram', 'TikTok', 'X / Twitter', 'Friend or referral', 'Other']
const WORK_AUTH_OPTIONS = [
  'Yes, and I do not require employer sponsorship now or in the future',
  'Yes, but I will require employer sponsorship now or in the future',
  'No',
]

export default function CareerApplyPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [workAuthorized, setWorkAuthorized] = useState('')
  const [heardAbout, setHeardAbout] = useState('')
  const [referredBy, setReferredBy] = useState('')
  const [availability, setAvailability] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [resume, setResume] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file && file.size > MAX_RESUME_BYTES) {
      setError('Resume must be under 5MB.')
      setResume(null)
      return
    }
    setError(null)
    setResume(file)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resume) {
      setError('A resume is required.')
      return
    }
    setError(null)
    setStatus('saving')

    try {
      const ext = resume.name.split('.').pop()
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('resumes').upload(path, resume)
      if (uploadErr) throw uploadErr

      const { error: insertErr } = await supabase.from('job_applications').insert({
        role: 'growth-intern',
        name,
        email,
        availability: availability || null,
        linkedin_url: linkedinUrl || null,
        work_authorized: workAuthorized || null,
        heard_about: heardAbout || null,
        referred_by: referredBy || null,
        cover_letter: coverLetter || null,
        resume_path: path,
      })
      if (insertErr) throw insertErr

      setStatus('done')
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <div className="job-done">
        <div className="job-done-title">Application received</div>
        <div className="job-done-body">Thanks, {name.split(' ')[0] || 'there'}. We review every application by hand and will reach out within a few business days.</div>
      </div>
    )
  }

  return (
    <form className="job-form" onSubmit={submit}>
          <div className="job-field">
            <label className="job-label" htmlFor="job-name">Full Name<span className="job-required">*</span></label>
            <input id="job-name" className="job-input" type="text" placeholder="Type here..." required value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="job-field">
            <label className="job-label" htmlFor="job-email">Email<span className="job-required">*</span></label>
            <input id="job-email" className="job-input" type="email" placeholder="hello@example.com..." required value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div className="job-field">
            <label className="job-label">Resume<span className="job-required">*</span></label>
            <label className={`job-file-wrap ${resume ? 'has-file' : ''}`}>
              <input type="file" accept={ACCEPTED_RESUME_TYPES} onChange={handleResumeChange} required />
              <div className="job-file-label">{resume ? resume.name : 'Upload File'}</div>
              {!resume && <div className="job-file-hint">or drag and drop here · .pdf, .doc, .docx, under 5MB</div>}
            </label>
          </div>

          <div className="job-field">
            <label className="job-label" htmlFor="job-linkedin">LinkedIn URL</label>
            <input id="job-linkedin" className="job-input" type="url" placeholder="Type here..." value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} />
          </div>

          <div className="job-field">
            <label className="job-label">Are you legally authorized to work in the United States?<span className="job-required">*</span></label>
            <div className="job-radio-group">
              {WORK_AUTH_OPTIONS.map(opt => (
                <label className="job-radio" key={opt}>
                  <input type="radio" name="work-auth" required value={opt} checked={workAuthorized === opt} onChange={() => setWorkAuthorized(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <div className="job-field">
            <label className="job-label">How did you hear about VisibleTrader?<span className="job-required">*</span></label>
            <div className="job-radio-group">
              {HEARD_ABOUT_OPTIONS.map(opt => (
                <label className="job-radio" key={opt}>
                  <input type="radio" name="heard-about" required value={opt} checked={heardAbout === opt} onChange={() => setHeardAbout(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <div className="job-field">
            <label className="job-label" htmlFor="job-referred">If you were referred, please share the name and email of who referred you</label>
            <input id="job-referred" className="job-input" type="text" placeholder="Type here..." value={referredBy} onChange={e => setReferredBy(e.target.value)} />
          </div>

          <div className="job-field">
            <label className="job-label" htmlFor="job-availability">How many videos a week can you realistically commit to?</label>
            <input id="job-availability" className="job-input" type="text" placeholder="e.g. 7-10 a week" value={availability} onChange={e => setAvailability(e.target.value)} />
          </div>

          <div className="job-field">
            <label className="job-label" htmlFor="job-cover">Why VisibleTrader?<span className="job-required">*</span></label>
            <p className="job-hint">What makes you want to make content about this specifically, not just UGC in general.</p>
            <textarea id="job-cover" className="job-textarea" placeholder="Type here..." required value={coverLetter} onChange={e => setCoverLetter(e.target.value)} />
          </div>

          {error && <div className="job-submit-error">{error}</div>}

      <button type="submit" className="career-apply-btn" disabled={status === 'saving'}>
        {status === 'saving' ? 'Submitting…' : 'Submit Application'}
      </button>
    </form>
  )
}
