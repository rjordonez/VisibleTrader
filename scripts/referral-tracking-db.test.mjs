// npm install --prefix /tmp/vt-referral-qa @electric-sql/pglite@0.5.16
// PGLITE_PACKAGE_DIR=/tmp/vt-referral-qa node scripts/referral-tracking-db.test.mjs
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
const require = createRequire(`${process.env.PGLITE_PACKAGE_DIR || process.cwd()}/package.json`)
const { PGlite } = require('@electric-sql/pglite')
const db = new PGlite()
const legacy = '00000000-0000-0000-0000-000000000001'
const unknown = '00000000-0000-0000-0000-000000000002'
const fresh = '00000000-0000-0000-0000-000000000003'
const direct = '00000000-0000-0000-0000-000000000004'
const email = '00000000-0000-0000-0000-000000000005'
const value = async sql => (await db.query(sql)).rows[0]
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, created_at timestamptz not null default now(), raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    insert into auth.users(id, raw_user_meta_data) values ('${legacy}', '{"referral_code":"3jpkjm"}'), ('${unknown}', '{}');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261118195940_referral_payment_tracking.sql', import.meta.url), 'utf8'))
  assert.equal((await value(`select referral_code from public.signup_attributions where user_id='${legacy}'`)).referral_code, '3jpkjm')
  await db.exec(`insert into auth.users(id) values ('${fresh}'), ('${direct}'); insert into auth.users(id,raw_user_meta_data) values ('${email}','{"referral_code":"jc"}');`)
  assert.equal((await value(`select source from signup_attributions where user_id='${fresh}'`)).source, 'pending')
  assert.equal((await value(`select source from signup_attributions where user_id='${email}'`)).source, 'signup_metadata')
  const claim = async (id, code) => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`)
    await db.query('select public.capture_signup_referral($1)', [code])
    await db.exec('reset role')
  }
  await claim(fresh, 'anthony')
  await claim(fresh, 'jc') // First claim must remain immutable.
  await claim(unknown, 'anthony') // Existing unknown account cannot gain a referral.
  await claim(direct, null)
  await claim(direct, 'anthony')
  await claim(email, 'anthony')
  assert.equal((await value(`select referral_code from signup_attributions where user_id='${fresh}'`)).referral_code, 'anthony')
  assert.equal((await value(`select referral_code from signup_attributions where user_id='${unknown}'`)).referral_code, null)
  assert.equal((await value(`select referral_code from signup_attributions where user_id='${direct}'`)).referral_code, null)
  assert.equal((await value(`select referral_code from signup_attributions where user_id='${email}'`)).referral_code, 'jc')
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${fresh}';`)
  assert.equal((await value('select count(*)::int as n from signup_attributions')).n, 1)
  await assert.rejects(() => db.exec(`update signup_attributions set referral_code='jc'`), /permission denied/)
  await assert.rejects(() => db.exec('select * from subscription_payments'), /permission denied/)
  await db.exec(`reset role; set role anon;`)
  await assert.rejects(() => db.exec(`select public.capture_signup_referral('anthony')`), /permission denied/)
  await db.exec('reset role')
  const payment = async (id, user, kind, live=true) => db.exec(`insert into subscription_payments
    (stripe_invoice_id,user_id,stripe_customer_id,stripe_subscription_id,amount_paid,currency,paid_at,payment_kind,livemode)
    values ('${id}','${user}','cus_${user}','sub_1',100,'usd',now(),'${kind}',${live}) on conflict(stripe_invoice_id) do nothing`)
  await payment('in_1', fresh, 'introductory')
  await payment('in_1', fresh, 'introductory') // Delivery replay / backfill duplicate.
  await payment('in_2', fresh, 'renewal')
  await payment('in_3', legacy, 'initial') // Both Anthony aliases aggregate together.
  await payment('in_test', email, 'initial', false)
  const report = await value(`select * from creator_referral_payments where creator='anthony'`)
  assert.equal(report.paying_customers, 2)
  assert.equal(report.paid_invoices, 3)
  assert.equal(Number(report.gross_paid_minor_units), 300)
  assert.equal(report.renewal_invoices, 1)
  assert.equal((await value('select count(*)::int as n from creator_referral_payments')).n, 1)
  await db.exec(`delete from auth.users where id='${fresh}'`)
  assert.equal((await value(`select paying_customers from creator_referral_payments where creator='anthony'`)).paying_customers, 2)
  assert.equal((await value(`select signups from creator_referral_signups where creator='anthony'`)).signups, 2)
  await db.exec('set role service_role')
  assert.equal((await value(`select count(*)::int as n from creator_referral_signups`)).n, 3)
  await db.exec('reset role')
  const insecure = await value(`select count(*)::int as n from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')`)
  assert.equal(insecure.n, 0)
  console.log('PASS: migration, signup capture, immutable claims, alias grouping, RLS, deduplication, test exclusion, and payment retention')
} catch (error) { console.error(error.message); process.exitCode = 1 } finally { await db.close() }
