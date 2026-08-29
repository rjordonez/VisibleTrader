// A real flat screenshot of the Winners mobile mockup (see
// WinnersPreviewMobile.tsx). Using the literal same image here and in
// WinnersPreviewMobile guarantees the two views can never visually drift
// out of sync the way two independent hand-built recreations did. The
// image's own background corners are exactly #06070f (--bg), so it blends
// with the page seamlessly without any cropping or masking.
export default function PhoneOverlay() {
  return (
    <img src="/phone-mockup.png" alt="" aria-hidden="true" className="device-phone-overlay-img" />
  )
}
