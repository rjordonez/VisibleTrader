import { strict as assert } from 'node:assert'
import { checkoutLineItems, MONTHLY_INTRO_OFFER, type CheckoutConfig } from './checkout.ts'

const config: CheckoutConfig = {
  monthlyPrice: 'price_monthly', introPrice: 'price_intro', weeklyPrice: 'price_weekly',
  weeklyCoupon: 'coupon_39', legacyCheckoutEnabled: false,
}
Deno.test('monthly offer charges a one-time $1 price and defers recurring billing seven days', () => {
  const params = checkoutLineItems({ offer: MONTHLY_INTRO_OFFER }, config)
  assert.equal(params.get('line_items[0][price]'), 'price_monthly')
  assert.equal(params.get('line_items[1][price]'), 'price_intro')
  assert.equal(params.get('subscription_data[trial_period_days]'), '7')
  assert.equal(params.get('payment_method_collection'), 'always')
  assert.equal(params.has('discounts[0][coupon]'), false)
})
Deno.test('old weekly clients cannot start another weekly subscription after cutover', () => {
  assert.throws(() => checkoutLineItems({ price_id: 'price_weekly' }, config), /refresh/)
  assert.equal(checkoutLineItems({ price_id: 'price_weekly' }, { ...config, legacyCheckoutEnabled: true }).get('discounts[0][coupon]'), 'coupon_39')
})
Deno.test('arbitrary client prices and unknown offers are rejected', () => {
  assert.throws(() => checkoutLineItems({ price_id: 'price_attacker' }, config))
  assert.throws(() => checkoutLineItems({ offer: 'free' }, config))
  assert.throws(() => checkoutLineItems({ offer: MONTHLY_INTRO_OFFER }, { ...config, introPrice: undefined }), /not configured/)
})
