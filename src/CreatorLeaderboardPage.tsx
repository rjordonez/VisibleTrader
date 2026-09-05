import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { avatarGradient, avatarInitial, onTabVisible } from './app/helpers'
import { SkelBlock } from './app/Skeleton'
import './app/app.css'

// Public page, no login — a link creators themselves can open. Reads
// creator_stats (Instagram) and tiktok_creator_stats (TikTok, only 4 of the
// 9 tracked creators have an account there) directly — RLS on both is an
// open anon-select `true` policy — rather than going through the app's
// normal auth'd Supabase client flows, since there's no session here at all.
interface CreatorRow {
  creator: string
  views: number
  reels: number
  gained: number | null
}

type Platform = 'creator_stats' | 'tiktok_creator_stats'
const PLATFORMS: Platform[] = ['creator_stats', 'tiktok_creator_stats']

const RANGES = [
  { id: 'all', label: 'All-time', days: null },
  { id: 'day', label: 'Daily', days: 1 },
  { id: 'week', label: 'Weekly', days: 7 },
  { id: 'month', label: 'Monthly', days: 30 },
] as const
type RangeId = typeof RANGES[number]['id']

function fmtCountdown(ms: number) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtViews(n: number) {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1) + 'M'
  if (abs >= 1000) return sign + (abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1) + 'k'
  return sign + abs.toLocaleString('en-US')
}

function SkelCreatorRow() {
  return (
    <div className="lb-row lb-1col">
      <div className="lb-trader">
        <SkelBlock width={18} height={12} />
        <div className="sig-skel" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
        <SkelBlock height={14} width={110} />
      </div>
      <div className="lb-stats">
        <div className="lb-col">
          <SkelBlock height={14} width={50} style={{ marginLeft: 'auto' }} />
        </div>
      </div>
    </div>
  )
}

// Fetches the single checked_at (a whole scrape run shares one timestamp)
// closest to `iso` without going past it, for one platform's table. Used to
// find the latest/baseline run for a lookback window without ever pulling
// more than one run's worth of rows regardless of how much scrape history
// has piled up. IG and TikTok scrape on independent schedules, so this is
// always looked up per-table rather than assuming a shared timestamp.
async function closestRunAtOrBefore(table: Platform, iso: string) {
  const { data, error } = await supabase
    .from(table)
    .select('checked_at')
    .lte('checked_at', iso)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.checked_at ?? null
}

async function earliestRun(table: Platform) {
  const { data, error } = await supabase
    .from(table)
    .select('checked_at')
    .order('checked_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.checked_at ?? null
}

async function viewsByCreatorAt(table: Platform, checkedAt: string) {
  const { data, error } = await supabase
    .from(table)
    .select('creator, view_count')
    .eq('checked_at', checkedAt)
  if (error) throw error
  const views = new Map<string, number>()
  const reels = new Map<string, number>()
  for (const r of data ?? []) {
    views.set(r.creator, (views.get(r.creator) ?? 0) + (r.view_count ?? 0))
    reels.set(r.creator, (reels.get(r.creator) ?? 0) + 1)
  }
  return { views, reels }
}

// One platform's current totals plus (if a lookback window is given) views
// gained since the closest run at/before that window — falling back to the
// earliest run on record when the window reaches further back than this
// platform's scrape history goes.
async function platformSnapshot(table: Platform, days: number | null) {
  const latestCheckedAt = await closestRunAtOrBefore(table, new Date().toISOString())
  if (!latestCheckedAt) return { views: new Map<string, number>(), reels: new Map<string, number>(), gained: null as Map<string, number> | null, latestCheckedAt: null as string | null }

  const { views, reels } = await viewsByCreatorAt(table, latestCheckedAt)

  let gained: Map<string, number> | null = null
  if (days) {
    const cutoff = new Date(new Date(latestCheckedAt).getTime() - days * 86400000).toISOString()
    const baselineCheckedAt = (await closestRunAtOrBefore(table, cutoff)) ?? (await earliestRun(table))
    const baselineViews = (baselineCheckedAt && baselineCheckedAt !== latestCheckedAt)
      ? (await viewsByCreatorAt(table, baselineCheckedAt)).views
      : new Map<string, number>()
    gained = new Map(Array.from(views, ([creator, v]) => [creator, v - (baselineViews.get(creator) ?? 0)]))
  }

  return { views, reels, gained, latestCheckedAt }
}

interface ReelRow {
  media_pk: string
  view_count: number
  platform: Platform
}

function reelUrl(creator: string, r: ReelRow) {
  return r.platform === 'creator_stats'
    ? `https://www.instagram.com/reel/${r.media_pk}/`
    : `https://www.tiktok.com/@${creator}/video/${r.media_pk}`
}

async function reelsForPlatform(table: Platform, creator: string): Promise<ReelRow[]> {
  const { data: latest, error: latestErr } = await supabase
    .from(table)
    .select('checked_at')
    .eq('creator', creator)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestErr) throw latestErr
  if (!latest) return []

  const { data, error } = await supabase
    .from(table)
    .select('media_pk, view_count')
    .eq('creator', creator)
    .eq('checked_at', latest.checked_at)
    .order('view_count', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({ ...r, platform: table }))
}

// media_pk is stored as each platform's own video id/shortcode (Instagram's
// URL shortcode, TikTok's aweme_id) — both plug directly into a real video
// URL with no lookup needed, since `creator` doubles as the TikTok username
// for the 4 creators tracked there too.
function CreatorReelsModal({ creator, onClose }: { creator: string; onClose: () => void }) {
  const [reels, setReels] = useState<ReelRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const [ig, tiktok] = await Promise.all(PLATFORMS.map(p => reelsForPlatform(p, creator)))
        if (cancelled) return
        setReels([...ig, ...tiktok].sort((a, b) => b.view_count - a.view_count))
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    run()
    return () => { cancelled = true }
  }, [creator])

  return (
    <div className="sig-modal-backdrop" onClick={onClose}>
      <div className="sig-modal-wrap" style={{ maxWidth: 720, maxHeight: 'min(80vh, 900px)' }} onClick={e => e.stopPropagation()}>
        <button className="sig-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sig-modal">
          <h2 className="onboarding-q" style={{ fontSize: 18, marginBottom: 4 }}>@{creator}</h2>
          <p className="app-section-sub" style={{ marginBottom: 16 }}>
            {reels === null ? 'Loading reels…' : error ? 'Connection trouble — retrying…' : `${reels.length} tracked video${reels.length === 1 ? '' : 's'}`}
          </p>
          {error && <div style={{ color: '#ff3b5c', fontSize: '0.875rem' }}>{error}</div>}
          {reels !== null && reels.length === 0 && !error && <div className="sig-empty">No videos tracked for this creator yet.</div>}
          {reels && reels.length > 0 && (
            <div className="lb-table">
              {reels.map((r, i) => (
                <a
                  className="lb-row lb-1col" key={`${r.platform}-${r.media_pk}`}
                  href={reelUrl(creator, r)}
                  target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <div className="lb-trader">
                    <span className="lb-rank">{i + 1}</span>
                    <div className="lb-sub" style={{ fontSize: 13.5 }}>
                      {r.platform === 'creator_stats' ? 'Instagram' : 'TikTok'} · {r.media_pk}
                    </div>
                  </div>
                  <div className="lb-stats">
                    <div className="lb-col">
                      <div className="lb-val">{fmtViews(r.view_count)}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CreatorLeaderboardPage() {
  const [range, setRange] = useState<RangeId>('all')
  const [rows, setRows] = useState<CreatorRow[]>([])
  const [lastScraped, setLastScraped] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openCreator, setOpenCreator] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (rangeId: RangeId) => {
    try {
      const days = RANGES.find(r => r.id === rangeId)?.days ?? null
      const [ig, tiktok] = await Promise.all(PLATFORMS.map(p => platformSnapshot(p, days)))

      if (!ig.latestCheckedAt && !tiktok.latestCheckedAt) {
        setRows([])
        setLastScraped(null)
        setLoading(false)
        setError(null)
        return
      }

      const creators = new Set([...ig.views.keys(), ...tiktok.views.keys()])
      const merged: CreatorRow[] = Array.from(creators, creator => ({
        creator,
        views: (ig.views.get(creator) ?? 0) + (tiktok.views.get(creator) ?? 0),
        reels: (ig.reels.get(creator) ?? 0) + (tiktok.reels.get(creator) ?? 0),
        gained: days ? (ig.gained?.get(creator) ?? 0) + (tiktok.gained?.get(creator) ?? 0) : null,
      }))
      merged.sort((a, b) => (days ? (b.gained ?? 0) - (a.gained ?? 0) : b.views - a.views))

      setRows(merged)
      setLastScraped([ig.latestCheckedAt, tiktok.latestCheckedAt].filter((x): x is string => !!x).sort().reverse()[0] ?? null)
      setLoading(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const wrapped = async () => { if (!cancelled) await load(range) }
    wrapped()
    const interval = setInterval(wrapped, 60000)
    const unsubVisible = onTabVisible(wrapped)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [range, load])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Both scrapers run on their own schedules (IG hourly, TikTok on its own
  // cadence) with no single shared "next run" timestamp exposed anywhere —
  // 24h after the most recent successful scrape is a reasonable stand-in
  // upper bound for "data this stale should refresh again by."
  const nextRefreshMs = lastScraped ? Math.max(0, new Date(lastScraped).getTime() + 86400000 - now) : null

  return (
    <div className="sig-page" style={{ padding: '48px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="app-section-header">
          <div>
            <h1 className="app-section-title">Creator Leaderboard</h1>
            {(loading || error) && (
              <p className="app-section-sub">{loading ? 'Loading…' : 'Connection trouble — retrying…'}</p>
            )}
          </div>
          {nextRefreshMs !== null && !loading && !error && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>
                Next refresh
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-dim)' }}>
                {fmtCountdown(nextRefreshMs)}
              </div>
            </div>
          )}
        </div>

        <div className="sig-panel">
          <div className="sig-chips" style={{ marginBottom: 16 }}>
            {RANGES.map(r => (
              <div key={r.id} className={range === r.id ? 'sig-chip active' : 'sig-chip'} onClick={() => setRange(r.id)}>
                {r.label}
              </div>
            ))}
          </div>

          {error && <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>}
          {!loading && !error && rows.length === 0 && <div className="sig-empty">No creator data yet.</div>}

          {(loading || (!error && rows.length > 0)) && (
            <div className="lb-table">
              <div className="lb-head lb-1col">
                <div>Creator</div>
                <div className="lb-col">{range === 'all' ? 'Views' : 'Gained'}</div>
              </div>

              {loading && Array.from({ length: 9 }).map((_, i) => <SkelCreatorRow key={i} />)}

              {!loading && rows.map((r, i) => (
                <div
                  className="lb-row lb-1col" key={r.creator}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenCreator(r.creator)}
                >
                  <div className="lb-trader">
                    <span className="lb-rank">{i + 1}</span>
                    <div className="lb-avatar" style={{ background: avatarGradient(r.creator) }}>{avatarInitial(r.creator, null)}</div>
                    <div style={{ minWidth: 0 }}>
                      <span className="lb-name">@{r.creator}</span>
                      <div className="lb-sub">{r.reels} video{r.reels === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                  <div className="lb-stats">
                    <div className="lb-col" data-label={range === 'all' ? 'Views' : 'Gained'}>
                      <div className="lb-col-stack">
                        <div className="lb-val">{r.gained === null ? fmtViews(r.views) : `+${fmtViews(r.gained)}`}</div>
                        {r.gained !== null && <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{fmtViews(r.views)} total</div>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {openCreator && <CreatorReelsModal creator={openCreator} onClose={() => setOpenCreator(null)} />}
    </div>
  )
}
