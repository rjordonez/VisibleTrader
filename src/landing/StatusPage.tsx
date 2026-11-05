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
// Last 24 hours in 30-minute blocks (public_status_intervals.bucket starts
// on :00/:30 UTC, matching date_bin in write_public_status).
const BLOCK_MS = 30 * 60 * 1000
const BLOCKS = 48
const STALE_AFTER_MS = 10 * 60 * 1000
const REFRESH_MS = 60 * 1000

type State = 'operational' | 'degraded' | 'outage' | 'unknown'
type Current = { component: string; status: Exclude<State, 'unknown'>; updated_at: string }
type Block = {
  bucket: string
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

function blockStarts(now: number) {
  const latest = Math.floor(now / BLOCK_MS) * BLOCK_MS
  return Array.from({ length: BLOCKS }, (_, i) => latest - (BLOCKS - 1 - i) * BLOCK_MS)
}

function blockState(b?: Block): State {
  if (!b) return 'unknown'
  if (b.outage_minutes >= 2) return 'outage'
  if (b.outage_minutes > 0 || b.degraded_minutes >= 5) return 'degraded'
  return 'operational'
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function blockTitle(start: number, b: Block | undefined, s: State) {
  const span = `${clock(start)} to ${clock(start + BLOCK_MS)}`
  if (!b) return `${span}: no data`
  const down = b.outage_minutes ? `, ${b.outage_minutes} min down` : ''
  const slow = b.degraded_minutes ? `, ${b.degraded_minutes} min slow` : ''
  return `${span}: ${LABEL[s]}${down}${slow}`
}

function uptime(days: Block[]) {
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
  const [blocks, setBlocks] = useState<Block[]>([])
  const [failed, setFailed] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const since = new Date(blockStarts(Date.now())[0]).toISOString()
      const [now, history] = await Promise.all([
        supabase.from('public_status').select('component, status, updated_at'),
        supabase.from('public_status_intervals').select('*').gte('bucket', since),
      ])
      if (cancelled) return
      setLoadedAt(Date.now())
      setFailed(!!now.error)
      if (!now.error) setCurrent((now.data ?? []) as Current[])
      if (!history.error) setBlocks((history.data ?? []) as Block[])
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
  const starts = blockStarts(loadedAt)

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
            const rows = blocks.filter(b => b.component === component)
            const byStart = new Map(rows.map(b => [new Date(b.bucket).getTime(), b]))
            const pct = uptime(rows)
            return (
              <li key={component} className="status-row">
                <div className="status-row-head">
                  <span className="status-name">{component}</span>
                  <span className={`status-pill status-${states[i]}`}>{LABEL[states[i]]}</span>
                </div>
                <div className="status-bars" aria-label={`${component}, last 24 hours`}>
                  {starts.map(start => {
                    const b = byStart.get(start)
                    const s = blockState(b)
                    return <span key={start} className={`status-bar status-${s}`} title={blockTitle(start, b, s)} />
                  })}
                </div>
                <div className="status-row-foot">
                  <span>24 h ago</span>
                  <span>{pct === null ? 'No data yet' : `${pct.toFixed(2)}% uptime, last 24 h`}</span>
                  <span>Now</span>
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
