import { strict as assert } from 'node:assert'
import { recordInvoicePayment, type PaidInvoice, type Payment } from './payments.ts'

const invoice: PaidInvoice = {
  id: 'in_intro', customer: 'cus_test', subscription: 'sub_test', status: 'paid',
  amount_paid: 100, currency: 'usd', livemode: true, billing_reason: 'subscription_create',
  status_transitions: { paid_at: 1800000000 },
}
const stripe = async () => ({ metadata: { supabase_user_id: 'user_test', offer: 'pro_monthly_intro_v1' } })
Deno.test('paid introductory invoice, renewal and resubscription retain distinct payment records', async () => {
  const saved: Payment[] = []
  const save = async (payment: Payment) => { saved.push(payment) }
  await recordInvoicePayment(invoice, stripe, save)
  await recordInvoicePayment({ ...invoice, id: 'in_renewal', amount_paid: 1999, billing_reason: 'subscription_cycle' }, stripe, save)
  await recordInvoicePayment({ ...invoice, id: 'in_new_sub', parent: { subscription_details: { subscription: 'sub_new' } }, subscription: null }, async path => {
    assert.equal(path, '/subscriptions/sub_new')
    return { metadata: { supabase_user_id: 'user_test' } }
  }, save)
  assert.deepEqual(saved.map(x => x.payment_kind), ['introductory', 'renewal', 'initial'])
  assert.equal(saved[0].paid_at, '2027-01-15T08:00:00.000Z')
  assert.equal(saved[1].amount_paid, 1999)
  assert.equal(saved[2].user_id, 'user_test')
})
Deno.test('free trial, failed, manually paid and non-subscription invoices never count as paid conversions', async () => {
  for (const change of [{ amount_paid: 0 }, { status: 'open' }, { paid_out_of_band: true }, { subscription: null }]) {
    await recordInvoicePayment({ ...invoice, ...change }, stripe, async () => { throw Error('must not write') })
  }
})
Deno.test('missing account metadata, missing timestamp and database errors propagate for webhook retry', async () => {
  await assert.rejects(() => recordInvoicePayment(invoice, async () => ({}), async () => {}), /Missing account/)
  await assert.rejects(() => recordInvoicePayment({ ...invoice, status_transitions: {} }, stripe, async () => {}), /Incomplete paid invoice/)
  await assert.rejects(() => recordInvoicePayment(invoice, stripe, async () => { throw Error('database offline') }), /database offline/)
})

Deno.test('trial end is preserved so $1 introductions cannot masquerade as converted subscriptions', async () => {
 const saved: Payment[]=[]
 const trial=async()=>({metadata:{supabase_user_id:'user_test',offer:'pro_monthly_intro_v1'},trial_end:1800000000})
 await recordInvoicePayment(invoice,trial,async p=>{saved.push(p)})
 await recordInvoicePayment({...invoice,id:'in_cycle',billing_reason:'subscription_cycle',amount_paid:16000,status_transitions:{paid_at:1800000001}},trial,async p=>{saved.push(p)})
 assert.equal(saved[0].payment_kind,'introductory')
 assert.equal(saved[1].payment_kind,'renewal')
 assert.equal(saved[0].trial_ended_at,'2027-01-15T08:00:00.000Z')
 assert.ok(saved.every(p=>p.trial_classification_checked))
})
