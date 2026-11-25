export const MONTHLY_INTRO_OFFER = 'pro_monthly_intro_v1'

export interface CheckoutConfig {
  monthlyPrice?: string
  introPrice?: string
  weeklyPrice?: string
  weeklyCoupon?: string
  eliteMonthlyPrice?: string
  eliteYearlyPrice?: string
  legacyCheckoutEnabled: boolean
}

// New checkouts don't accept Discover: it was ~6% of revenue but nearly a
// quarter of disputes, and Discover sends no early fraud warnings and isn't
// covered by Visa RDR / Mastercard Ethoca. Existing Discover customers keep
// renewing on their saved card. Remove the brand here to accept it again.
export const BLOCKED_CARD_BRANDS = ['discover_global_network']

export function blockedBrandParams(brands: string[] = BLOCKED_CARD_BRANDS): URLSearchParams {
  const params = new URLSearchParams()
  brands.forEach((brand, i) => params.set(`payment_method_options[card][restrictions][brands_blocked][${i}]`, brand))
  return params
}

export const THREE_DS_TEST = 'tds_test_v1'

// 3D Secure A/B test. Assignment hashes the user id so a person who reopens
// checkout stays in the same group; B asks Stripe to always request 3DS on
// card entry (wallets like Apple Pay / Link mostly authenticate on-device
// and skip it). The group rides on session + subscription metadata so later
// charges, disputes and fraud warnings can be split by group.
export function threeDSTestArm(userId: string): 'A' | 'B' {
  let h = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 2 === 0 ? 'A' : 'B'
}

export function threeDSTestParams(userId: string, enabled: boolean): URLSearchParams {
  const params = new URLSearchParams()
  if (!enabled) return params
  const arm = threeDSTestArm(userId)
  params.set(`metadata[${THREE_DS_TEST}]`, arm)
  params.set(`subscription_data[metadata][${THREE_DS_TEST}]`, arm)
  if (arm === 'B') params.set('payment_method_options[card][request_three_d_secure]', 'any')
  return params
}

// Offer identifiers let the public page select a server-owned price without
// needing a frontend environment-variable deployment to match the backend.
export function checkoutLineItems(
  input: { offer?: string; price_id?: string },
  config: CheckoutConfig,
): URLSearchParams {
  if (input.offer === MONTHLY_INTRO_OFFER) {
    if (!config.monthlyPrice || !config.introPrice) throw new Error('monthly offer is not configured')
    return new URLSearchParams({
      'line_items[0][price]': config.monthlyPrice,
      'line_items[0][quantity]': '1',
      'line_items[1][price]': config.introPrice,
      'line_items[1][quantity]': '1',
      'subscription_data[trial_period_days]': '7',
      'subscription_data[trial_settings][end_behavior][missing_payment_method]': 'cancel',
      'subscription_data[metadata][offer]': MONTHLY_INTRO_OFFER,
      'metadata[offer]': MONTHLY_INTRO_OFFER,
      payment_method_collection: 'always',
    })
  }
  if (input.offer) throw new Error('invalid offer')

  // Enabled only during the deployment overlap. Turning this off stops old
  // pages creating more weekly checkouts, without touching any subscriptions.
  if (config.legacyCheckoutEnabled && input.price_id && input.price_id === config.weeklyPrice) {
    if (!config.weeklyCoupon) throw new Error('weekly offer is not configured')
    return new URLSearchParams({
      'line_items[0][price]': input.price_id,
      'line_items[0][quantity]': '1',
      'discounts[0][coupon]': config.weeklyCoupon,
    })
  }
  if (input.price_id && [config.eliteMonthlyPrice, config.eliteYearlyPrice].includes(input.price_id)) {
    return new URLSearchParams({
      'line_items[0][price]': input.price_id,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '7',
    })
  }
  throw new Error('Pricing has changed. Please refresh the pricing page and try again.')
}
