import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import LandingLayout from './landing/LandingLayout'
import Landing from './landing/index'
import PricingPage from './landing/PricingPage'
import EstimatePage from './landing/EstimatePage'
import CalculatorsPage from './landing/CalculatorsPage'
import BlogPage from './landing/BlogPage'
import CareersPage from './landing/CareersPage'
import PrivacyPage from './landing/PrivacyPage'
import TermsPage from './landing/TermsPage'
import RefundPage from './landing/RefundPage'
import SignupPage from './landing/SignupPage'
import LoginPage from './landing/LoginPage'
import ForgotPasswordPage from './landing/ForgotPasswordPage'
import ResetPasswordPage from './landing/ResetPasswordPage'
import AppShell from './app/index'
import ProtectedRoute from './ProtectedRoute'
import SearchPage from './SearchPage'

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
  return isAppHost ? <AppRoutes /> : <MarketingRoutes />
}
