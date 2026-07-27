import { useEffect, useRef } from 'react'

const stats = [
  { value: '500',   label: 'Wallets tracked by default' },
  { value: '<1s',   label: 'Signal latency, tick to card' },
  { value: '100%',  label: 'On-chain, verifiable trades' },
]

export default function HowItWorks() {
  const statsRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { statsRef.current?.classList.add('in-view'); observer.disconnect() } },
      { threshold: 0.4 }
    )
    if (statsRef.current) observer.observe(statsRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (window.innerWidth <= 768) return
    let lastY   = window.scrollY
    let current = 0
    let rafId: number

    const tick = () => {
      const y   = window.scrollY
      const vel = Math.abs(y - lastY)
      lastY     = y
      const target = Math.min(vel * 1.2, 20)
      current += (target - current) * 0.08
      innerRef.current!.style.transform = `translateY(${-current}px)`
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <section className="section how-it-works" id="how-it-works">

      <div className="hiw-bar hiw-bar-top" />

      <div ref={innerRef} className="section-inner">
        <div ref={statsRef} className="hiw-stats">
          {stats.map((s, i) => (
            <div key={s.label} className="hiw-stat" style={{ '--i': i } as React.CSSProperties}>
              <div className="hiw-stat-value">{s.value}</div>
              <div className="hiw-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="platforms-wrap">
          <p className="platforms-label">Built on Polymarket</p>
          <div className="platforms">
            {[
              { name: 'Polymarket', src: '/polymarket.png' },
            ].map(p => (
              <img key={p.name} src={p.src} alt={p.name} className="platform-logo-sq" />
            ))}
          </div>
        </div>
      </div>

      <div className="hiw-bar hiw-bar-bot" />

    </section>
  )
}
