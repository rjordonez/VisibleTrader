// Purely decorative — a blue glow (same ellipse blue as the top of the
// page) fading into the ocean-floor image right before the footer, so
// the page reads as bookended by the same underwater theme top and
// bottom instead of just fading to flat black.
export default function OceanFloor() {
  return (
    <div className="ocean-floor">
      <img src="/ocean-floor.png" alt="" aria-hidden="true" />
    </div>
  )
}
