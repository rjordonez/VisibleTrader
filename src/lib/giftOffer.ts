// A ?gift=1 link (e.g. https://visibletrader.com/pricing?gift=1) marks a
// visitor for the first-week-free offer instead of the standard $1 one —
// see create-checkout-session, which swaps in STRIPE_COUPON_GIFT_FIRST_WEEK
// when it receives gift:true.
//
// Captured into localStorage (not just read from the current URL) because
// checkout only actually happens once the visitor is signed in, and signup
// itself lives on the app subdomain — a different origin, so the query
// param wouldn't survive that round trip. localStorage on the marketing
// origin does, since the visitor leaves for signup and later comes back to
// this same origin's /pricing to finish checkout.
const GIFT_KEY = 'vt_gift_first_week'

export function captureGiftOffer() {
  if (new URLSearchParams(window.location.search).get('gift') === '1') {
    localStorage.setItem(GIFT_KEY, '1')
  }
}

export function hasGiftOffer(): boolean {
  return localStorage.getItem(GIFT_KEY) === '1'
}
