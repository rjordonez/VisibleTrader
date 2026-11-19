import { strict as assert } from 'node:assert'
import { blockedBrandParams, checkoutLineItems, MONTHLY_INTRO_OFFER, threeDSTestArm, threeDSTestParams, type CheckoutConfig } from './checkout.ts'

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
Deno.test('3DS test is off unless enabled', () => {
  assert.equal([...threeDSTestParams('user-1', false)].length, 0)
})
Deno.test('3DS test assigns a stable group and only B requests 3DS', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  let b = 0
  for (const id of ids) {
    const p = threeDSTestParams(id, true)
    const arm = p.get('metadata[tds_test_v1]')
    assert.equal(arm, threeDSTestArm(id))
    assert.equal(p.get('subscription_data[metadata][tds_test_v1]'), arm)
    assert.equal(p.get('payment_method_options[card][request_three_d_secure]'), arm === 'B' ? 'any' : null)
    if (arm === 'B') b++
  }
  assert.ok(b > 150 && b < 250, `split should be near even, got ${b}/400`)
})

Deno.test('new checkouts block Discover cards', () => {
  assert.equal(blockedBrandParams().get('payment_method_options[card][restrictions][brands_blocked][0]'), 'discover_global_network')
  assert.equal([...blockedBrandParams([])].length, 0)
})
