import Hero from './components/Hero'
import FeatureShowcase from './components/FeatureShowcase'
import CTABanner from './components/CTABanner'
import OceanFloor from './components/OceanFloor'
import Footer from './components/Footer'

// The pricing section is intentionally omitted from the homepage for now —
// the $40/week recurring price was moving sticker-shock ahead of any
// value, and the /pricing page (still linked in the navbar) doubles as the
// checkout step, so nothing in the funnel breaks. Re-add <PricingPage />
// here to bring it back.
export default function Landing() {
  return (
    <>
      <Hero />
      <FeatureShowcase />
      <CTABanner />
      <OceanFloor />
      <Footer />
    </>
  )
}
