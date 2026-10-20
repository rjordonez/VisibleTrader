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
