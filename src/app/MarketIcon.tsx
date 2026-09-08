import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { categoryIcon } from './helpers'
import { supabase } from '../lib/supabase'

// Share requests across repeated trades, search results, and market details.
const images = new Map<string, Promise<string | null>>()
function fetchImage(conditionId: string, outcome: string) {
  const key = conditionId
  let request = images.get(key)
  if (!request) {
    request = supabase.functions.invoke('price-chart', {
      body: { condition_id: conditionId, outcome, image_only: true },
    }).then(({ data }) => {
      const image = data?.image
      if (typeof image === 'string' && image.startsWith('https://')) return image
      images.delete(key)
      return null
    }).catch(() => { images.delete(key); return null })
    if (images.size >= 250) images.delete(images.keys().next().value!)
    images.set(key, request)
  }
  return request
}

export function MarketIcon({ conditionId, outcome, category, className, style, source }: {
  conditionId: string; outcome: string; category: string | null; className: string
  style?: CSSProperties; source?: string | null
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [loaded, setLoaded] = useState<{ key: string; image: string | null } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const fallback = categoryIcon(category)
  const image = source !== undefined ? source : loaded?.key === conditionId ? loaded.image : null
  useEffect(() => {
    if (source !== undefined) return
    let cancelled = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      fetchImage(conditionId, outcome).then(image => {
        if (!cancelled) setLoaded({ key: conditionId, image })
      })
    }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => { cancelled = true; observer.disconnect() }
  }, [conditionId, outcome, source])
  return (
    <span ref={ref} className={className} style={{ background: fallback.bg, overflow: 'hidden', ...style }} aria-hidden="true">
      {image && failed !== image
        ? <img src={image} alt="" loading="lazy" decoding="async" onError={() => setFailed(image)} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        : fallback.emoji}
    </span>
  )
}
