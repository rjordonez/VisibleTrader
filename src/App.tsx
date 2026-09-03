import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import LandingLayout from './landing/LandingLayout'
import { captureGiftOffer } from './lib/giftOffer'

// Route-level code splitting — every one of these used to be a static
// top-level import, which meant the single JS bundle (1.2MB / 368KB gzipped,
// confirmed via the build output) shipped both the entire marketing site
// AND the entire authenticated app (recharts, every tab, the Terminal, all
// landing pages) to every single visitor regardless of which one they
// actually hit, since MarketingRoutes/AppRoutes are picked by a runtime
// check (isAppHost) that Vite can't tree-shake around at build time. lazy()
// turns each page into its own chunk, fetched only when that route actually
// renders — a marketing visitor never downloads AppShell/Terminal/recharts,
// and an app visitor never downloads the landing/blog/calculators pages.
const Landing = lazy(() => import('./landing/index'))
const PricingPage = lazy(() => import('./landing/PricingPage'))
const EstimatePage = lazy(() => import('./landing/EstimatePage'))
const CalculatorsPage = lazy(() => import('./landing/CalculatorsPage'))
const BlogPage = lazy(() => import('./landing/BlogPage'))
const CareersPage = lazy(() => import('./landing/CareersPage'))
const PrivacyPage = lazy(() => import('./landing/PrivacyPage'))
const TermsPage = lazy(() => import('./landing/TermsPage'))
const RefundPage = lazy(() => import('./landing/RefundPage'))
const SignupPage = lazy(() => import('./landing/SignupPage'))
const LoginPage = lazy(() => import('./landing/LoginPage'))
const ForgotPasswordPage = lazy(() => import('./landing/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./landing/ResetPasswordPage'))
const AppShell = lazy(() => import('./app/index'))
const Terminal = lazy(() => import('./app/terminal/Terminal'))
// Only ever used inside AppRoutes (never MarketingRoutes) — but was still a
// static top-level import, which pulled it (and now, transitively via
// OnboardingPage, app.css) into the shared base bundle every visitor
// downloads. Lazy like everything else above keeps marketing visitors from
// ever touching it.
const ProtectedRoute = lazy(() => import('./ProtectedRoute'))
const SearchPage = lazy(() => import('./SearchPage'))

function PageLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#06070f', color: '#6b7280', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.875rem' }}>
      Loading…
    </div>
  )
}

// app.visibletrader.com serves auth + the dashboard; visibletrader.com
// serves marketing only. In dev there's no real subdomain, so `/app/*` on
// localhost keeps working as the existing local-testing shortcut — see
// src/lib/domains.ts, which every cross-boundary link goes through.
const isAppHost = window.location.hostname.startsWith('app.')
  || (import.meta.env.DEV && window.location.pathname.startsWith('/app'))

// Sends anyone hitting an old visibletrader.com/app/*, /login, /signup,
// etc. link (bookmarks, old emails) over to the real spot on the app
// subdomain instead of 404ing. Only ever reached on the marketing side —
// dev testing never produces one of these links in the first place, since
// Navbar/PricingPage build dev-mode links via the local /app prefix
// directly rather than routing through here.
function CrossDomainRedirect() {
  const location = useLocation()
  useEffect(() => {
    const path = location.pathname.startsWith('/app')
      ? location.pathname.slice(4) || '/'
      : location.pathname
    window.location.href = `https://app.visibletrader.com${path}${location.search}`
  }, [location])
  return null
}

function MarketingRoutes() {
  // Captured here (not inside PricingPage) so a ?gift=1 link works no
  // matter which marketing page it points to — including /signup, which
  // immediately redirects cross-domain via CrossDomainRedirect below, so
  // this has to run and persist to localStorage before that navigation
  // fires. See giftOffer.ts for why localStorage instead of just reading
  // the URL at checkout time.
  useEffect(() => { captureGiftOffer() }, [])
  return (
    <Routes>
      <Route element={<LandingLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/calculators" element={<CalculatorsPage />} />
        <Route path="/blog" element={<BlogPage />} />
        <Route path="/careers" element={<CareersPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/refund-policy" element={<RefundPage />} />
      </Route>
      <Route path="/estimate" element={<EstimatePage />} />
      <Route path="/app/*" element={<CrossDomainRedirect />} />
      <Route path="/login" element={<CrossDomainRedirect />} />
      <Route path="/signup" element={<CrossDomainRedirect />} />
      <Route path="/forgot-password" element={<CrossDomainRedirect />} />
      <Route path="/reset-password" element={<CrossDomainRedirect />} />
      <Route path="/search" element={<CrossDomainRedirect />} />
    </Routes>
  )
}

function AppRoutes() {
  // Same reasoning as MarketingRoutes above — a ?gift=1 link pointing
  // straight at app.visibletrader.com/pricing (the real same-origin
  // checkout path signed-in users actually use, see the /pricing route's
  // own comment below) needs this captured here too, not just on the
  // marketing domain.
  useEffect(() => { captureGiftOffer() }, [])
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public — reachable while logged out, so it must sit outside
          ProtectedRoute like the auth pages above, not inside AppShell. */}
      <Route path="/search" element={<SearchPage />} />
      {/* Same-origin pricing page for signed-in-but-unsubscribed users (the
          AppShell lock overlay links here) — must stay on the app domain,
          not the marketing one, so the session Supabase already has in this
          origin's localStorage is visible to startCheckout's auth check.
          Sitting outside ProtectedRoute like /search above so it's reachable
          without a subscription. */}
      <Route path="/pricing" element={<PricingPage />} />
      {/* Full-bleed, own-chrome page — deliberately outside AppShell's
          <Routes> below so it never renders the normal app-header/tab nav/
          mobile bottom bar (see the plan this was built from). Still
          behind ProtectedRoute like everything else under here. */}
      <Route path="/terminal/*" element={<ProtectedRoute><Terminal /></ProtectedRoute>} />
      {/* Dev-only: mirrors the routes above under /app so the local
          `localhost:5173/app/...` testing convention keeps working —
          dead code in prod, stripped by Vite's import.meta.env.DEV check. */}
      {import.meta.env.DEV && (
        <>
          <Route path="/app/login" element={<LoginPage />} />
          <Route path="/app/signup" element={<SignupPage />} />
          <Route path="/app/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/app/reset-password" element={<ResetPasswordPage />} />
          <Route path="/app/search" element={<SearchPage />} />
          <Route path="/app/pricing" element={<PricingPage />} />
          <Route path="/app/terminal/*" element={<ProtectedRoute><Terminal /></ProtectedRoute>} />
        </>
      )}
      {/* AppShell renders its own nested <Routes> for /signals, /profits,
          etc. — a descendant <Routes> automatically matches against
          whatever's left after the parent Route's own match, so in dev
          this needs to be /app/* (consuming the /app prefix) for that
          remainder to line up with prod, where there's no prefix at all. */}
      <Route path={import.meta.env.DEV ? '/app/*' : '/*'} element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
    </Routes>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      {isAppHost ? <AppRoutes /> : <MarketingRoutes />}
    </Suspense>
  )
}
