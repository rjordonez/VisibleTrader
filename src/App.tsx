import { Routes, Route } from 'react-router-dom'
import LandingLayout from './landing/LandingLayout'
import Landing from './landing/index'
import PricingPage from './landing/PricingPage'
import EstimatePage from './landing/EstimatePage'
import FeaturePage from './landing/FeaturePage'
import CalculatorsPage from './landing/CalculatorsPage'
import SignupPage from './landing/SignupPage'
import LoginPage from './landing/LoginPage'
import ForgotPasswordPage from './landing/ForgotPasswordPage'
import ResetPasswordPage from './landing/ResetPasswordPage'
import AppShell from './app/index'
import ProtectedRoute from './ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route element={<LandingLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/features/:id" element={<FeaturePage />} />
        <Route path="/calculators" element={<CalculatorsPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route path="/estimate" element={<EstimatePage />} />
      <Route path="/app/*" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
    </Routes>
  )
}
