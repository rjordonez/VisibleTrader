import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase'
import { avatarGradient, avatarInitial, onTabVisible } from './app/helpers'
import { SkelBlock } from './app/Skeleton'
import './app/app.css'

// Public page, no login — a link creators themselves can open. Reads
// creator_stats (Instagram) and tiktok_creator_stats (TikTok, only 4 of the
// 9 tracked creators have an account there) directly — RLS on both is an
// open anon-select `true` policy — rather than going through the app's
// normal auth'd Supabase client flows, since there's no session here at all.
//
// The board ranks by views since the most recent 10am PST reset (a fixed
// daily contest window), not lifetime totals — Daily/Weekly/Monthly range
// toggles were tried and pulled earlier for being misleading in the same
// way this can be: a newly-appeared reel/video counts its full view total
// as "since reset" even though it existed before the boundary. Kept anyway
// per explicit request, since a fixed daily reset is a legible, standard
// leaderboard format even with that caveat.
interface CreatorRow {
  creator: string
  views: number
  sinceReset: number
  reels: number
}

type Platform = 'creator_stats' | 'tiktok_creator_stats'
const PLATFORMS: Platform[] = ['creator_stats', 'tiktok_creator_stats']

const PLATFORM_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'creator_stats', label: 'Instagram' },
  { id: 'tiktok_creator_stats', label: 'TikTok' },
] as const
type PlatformFilter = typeof PLATFORM_FILTERS[number]['id']

function fmtCountdown(ms: number) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtViews(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k'
  return n.toLocaleString('en-US')
}

// "10am PST" means 10am America/Los_Angeles wall-clock time year-round
// (PST or PDT, whichever is in effect) — computed via Intl rather than a
// hardcoded UTC-8 offset so it stays correct across the DST transition.
function laOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(date)
  const tz = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT-8'
  const match = tz.match(/GMT([+-]\d+)/)
  return match ? parseInt(match[1], 10) * 60 : -480
}

function dailyResetBoundaries(now: Date) {
  const offsetMin = laOffsetMinutes(now)
  const laShifted = new Date(now.getTime() + offsetMin * 60000)
  const y = laShifted.getUTCFullYear(), m = laShifted.getUTCMonth(), d = laShifted.getUTCDate()
  let nextMs = Date.UTC(y, m, d, 10, 0, 0) - offsetMin * 60000
  if (nextMs <= now.getTime()) nextMs = Date.UTC(y, m, d + 1, 10, 0, 0) - offsetMin * 60000
  return { previous: new Date(nextMs - 86400000), next: new Date(nextMs) }
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
// closest to `iso` without going past it, for one platform's table. Keeps
// this bounded regardless of how much scrape history has piled up. IG and
// TikTok scrape on independent schedules, so this is always looked up
// per-table rather than assuming a shared timestamp.
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

async function latestRunAt(table: Platform) {
  return closestRunAtOrBefore(table, new Date().toISOString())
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

interface PlatformSnapshot {
  views: Map<string, number>
  sinceReset: Map<string, number>
  reels: Map<string, number>
  checkedAt: string | null
}

async function platformSnapshot(table: Platform, resetBoundaryIso: string): Promise<PlatformSnapshot> {
  const checkedAt = await latestRunAt(table)
  if (!checkedAt) return { views: new Map(), sinceReset: new Map(), reels: new Map(), checkedAt: null }
  const { views, reels } = await viewsByCreatorAt(table, checkedAt)

  const baselineCheckedAt = await closestRunAtOrBefore(table, resetBoundaryIso)
  const baselineViews = (baselineCheckedAt && baselineCheckedAt !== checkedAt)
    ? (await viewsByCreatorAt(table, baselineCheckedAt)).views
    : new Map<string, number>()
  const sinceReset = new Map(Array.from(views, ([creator, v]) => [creator, v - (baselineViews.get(creator) ?? 0)]))

  return { views, sinceReset, reels, checkedAt }
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

const EMPTY_SNAPSHOT: PlatformSnapshot = { views: new Map(), sinceReset: new Map(), reels: new Map(), checkedAt: null }

export default function CreatorLeaderboardPage() {
  const [snapshots, setSnapshots] = useState<Record<Platform, PlatformSnapshot>>({
    creator_stats: EMPTY_SNAPSHOT,
    tiktok_creator_stats: EMPTY_SNAPSHOT,
  })
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openCreator, setOpenCreator] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const { previous } = dailyResetBoundaries(new Date())
      const [ig, tiktok] = await Promise.all(PLATFORMS.map(p => platformSnapshot(p, previous.toISOString())))
      setSnapshots({ creator_stats: ig, tiktok_creator_stats: tiktok })
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
    const wrapped = async () => { if (!cancelled) await load() }
    wrapped()
    const interval = setInterval(wrapped, 60000)
    const unsubVisible = onTabVisible(wrapped)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [load])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Filtering is a client-side reslice of data already fetched for both
  // platforms — switching the chip is instant, no network round-trip.
  const activePlatforms = platformFilter === 'all' ? PLATFORMS : [platformFilter]

  const rows = useMemo(() => {
    const creators = new Set(activePlatforms.flatMap(p => [...snapshots[p].views.keys()]))
    const merged: CreatorRow[] = Array.from(creators, creator => ({
      creator,
      views: activePlatforms.reduce((sum, p) => sum + (snapshots[p].views.get(creator) ?? 0), 0),
      sinceReset: activePlatforms.reduce((sum, p) => sum + (snapshots[p].sinceReset.get(creator) ?? 0), 0),
      reels: activePlatforms.reduce((sum, p) => sum + (snapshots[p].reels.get(creator) ?? 0), 0),
    }))
    merged.sort((a, b) => b.sinceReset - a.sinceReset)
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, platformFilter])

  const nextResetMs = Math.max(0, dailyResetBoundaries(new Date(now)).next.getTime() - now)

  return (
    <div className="sig-page" style={{ padding: '48px 20px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="app-section-header">
          <div>
            <h1 className="app-section-title">Creator Leaderboard</h1>
            <p className="app-section-sub">
              {loading ? 'Loading…' : error ? 'Connection trouble — retrying…' : 'Resets daily at 10am PST'}
            </p>
          </div>
          {!loading && !error && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 2 }}>
                Next reset
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-dim)' }}>
                {fmtCountdown(nextResetMs)}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: 'var(--red)', lineHeight: 1.5 }}>
          Views here are for tracking purposes only, not a direct indication of payout. To count toward CPM earnings, a video needs a call-to-action for VisibleTrader in it.
        </div>

        <div className="sig-panel">
          <div className="sig-chips" style={{ marginBottom: 16 }}>
            {PLATFORM_FILTERS.map(f => (
              <div key={f.id} className={platformFilter === f.id ? 'sig-chip active' : 'sig-chip'} onClick={() => setPlatformFilter(f.id)}>
                {f.label}
              </div>
            ))}
          </div>

          {error && <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>}
          {!loading && !error && rows.length === 0 && <div className="sig-empty">No creator data yet.</div>}

          {(loading || (!error && rows.length > 0)) && (
            <div className="lb-table">
              <div className="lb-head lb-1col">
                <div>Creator</div>
                <div className="lb-col">Views today</div>
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
                    <div className="lb-col" data-label="Views today">
                      <div className="lb-col-stack">
                        <div className="lb-val">{fmtViews(Math.max(0, r.sinceReset))}</div>
                        <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{fmtViews(r.views)} total</div>
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
