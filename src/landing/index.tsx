import Hero from './components/Hero'
import FeatureShowcase from './components/FeatureShowcase'
import PricingPage from './PricingPage'
import FAQ from './components/FAQ'
import CTABanner from './components/CTABanner'
import Footer from './components/Footer'

export default function Landing() {
  return (
    <>
      <Hero />
      <FeatureShowcase />
      <PricingPage />
      <FAQ />
      <CTABanner />
      <Footer />
    </>
  )
}
