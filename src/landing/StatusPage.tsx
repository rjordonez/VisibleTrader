import './landing.css'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from './components/Footer'
import { supabase } from '../lib/supabase'

// Written once a minute by live-signal-service's health report (see
// write_public_status). A row older than STALE_AFTER_MS means the reporter
// itself stopped, so the page says "unknown" rather than trusting it.
const COMPONENTS = [
  'Website',
  'App',
  'Live trade feed',
  'Trader data & leaderboards',
  'Payments & checkout',
  'Wallet search',
  'Polymarket (upstream)',
]
const DAYS = 30
const STALE_AFTER_MS = 10 * 60 * 1000
const REFRESH_MS = 60 * 1000

type State = 'operational' | 'degraded' | 'outage' | 'unknown'
type Current = { component: string; status: Exclude<State, 'unknown'>; updated_at: string }
type Daily = {
  day: string
  component: string
  operational_minutes: number
  degraded_minutes: number
  outage_minutes: number
}

const LABEL: Record<State, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  unknown: 'Unknown',
}

function dayKeys() {
  const keys: string[] = []
  const today = new Date()
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    keys.push(d.toISOString().slice(0, 10))
  }
  return keys
}

function dayState(d?: Daily): State {
  if (!d) return 'unknown'
  if (d.outage_minutes >= 5) return 'outage'
  if (d.outage_minutes > 0 || d.degraded_minutes >= 15) return 'degraded'
  return 'operational'
}

function uptime(days: Daily[]) {
  const total = days.reduce((n, d) => n + d.operational_minutes + d.degraded_minutes + d.outage_minutes, 0)
  if (!total) return null
  const up = days.reduce((n, d) => n + d.operational_minutes + d.degraded_minutes, 0)
  return (up / total) * 100
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

export default function StatusPage() {
  const [current, setCurrent] = useState<Current[] | null>(null)
  const [daily, setDaily] = useState<Daily[]>([])
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const since = dayKeys()[0]
      const [now, history] = await Promise.all([
        supabase.from('public_status').select('component, status, updated_at'),
        supabase.from('public_status_daily').select('*').gte('day', since),
      ])
      if (cancelled) return
      setLoadedAt(Date.now())
      setFailed(!!now.error)
      if (!now.error) setCurrent((now.data ?? []) as Current[])
      if (!history.error) setDaily((history.data ?? []) as Daily[])
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const newest = current?.reduce<string | null>((max, r) => (!max || r.updated_at > max ? r.updated_at : max), null) ?? null
  const fresh = !!newest && loadedAt - new Date(newest).getTime() < STALE_AFTER_MS
  const stateOf = (component: string): State => {
    const row = current?.find(r => r.component === component)
    return row && fresh ? row.status : 'unknown'
  }
  const states = COMPONENTS.map(stateOf)
  const overall: State = failed || !fresh ? 'unknown'
    : states.includes('outage') ? 'outage'
    : states.includes('degraded') ? 'degraded'
    : 'operational'
  const banner: Record<State, string> = {
    operational: 'All systems operational',
    degraded: 'Some systems are running slowly',
    outage: 'Some systems are down',
    unknown: current === null && !failed ? 'Checking status…' : 'Status is temporarily unavailable',
  }
  const keys = dayKeys()

  return (
    <>
      <div className="blog-content legal-content status-page">
        <Link to="/" className="legal-back">← Back to home</Link>
        <h1 className="blog-title">System status</h1>
        <p className="blog-sub">
          Checked every minute.{newest ? ` Last check ${ago(newest, loadedAt)}.` : ''}
        </p>

        <div className={`status-banner status-${overall}`}>
          <span className="status-dot" />
          {banner[overall]}
        </div>

        <ul className="status-list">
          {COMPONENTS.map((component, i) => {
            const rows = daily.filter(d => d.component === component)
            const pct = uptime(rows)
            return (
              <li key={component} className="status-row">
                <div className="status-row-head">
                  <span className="status-name">{component}</span>
                  <span className={`status-pill status-${states[i]}`}>{LABEL[states[i]]}</span>
                </div>
                <div className="status-bars" aria-label={`${component}, last ${DAYS} days`}>
                  {keys.map(day => {
                    const d = rows.find(r => r.day === day)
                    const s = dayState(d)
                    return <span key={day} className={`status-bar status-${s}`} title={`${day}: ${LABEL[s]}`} />
                  })}
                </div>
                <div className="status-row-foot">
                  <span>{DAYS} days ago</span>
                  <span>{pct === null ? 'No data yet' : `${pct.toFixed(2)}% uptime`}</span>
                  <span>Today</span>
                </div>
              </li>
            )
          })}
        </ul>

        <p className="status-note">
          Polymarket (upstream) is Polymarket's own data service, which VisibleTrader depends on. If something looks
          wrong and isn't shown here, email <a href="mailto:hq@visibletrader.com">hq@visibletrader.com</a>.
        </p>
      </div>
      <Footer />
    </>
  )
}
