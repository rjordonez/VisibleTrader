"""Results of the checkout 3D Secure A/B test (metadata key tds_test_v1).

Group A = normal checkout, group B = 3DS requested on card entry.
Reads live Stripe data (STRIPE_SECRET_KEY_LIVE, falling back to
STRIPE_SECRET_KEY) and prints, per group:
  - checkout completion (did the extra bank step lose people?)
  - first $160 charge approval for trials that reached it
  - disputes and early fraud warnings per subscriber

Usage: python3 scripts/tds_test_report.py
"""
import base64
import collections
import json
import os
import time
import urllib.parse
import urllib.request

from _env import load_env

KEY = 'tds_test_v1'


def stripe_get(path, auth, **params):
    url = 'https://api.stripe.com/v1/' + path + '?' + urllib.parse.urlencode(params, doseq=True)
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'Authorization': auth})
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f'Stripe request failed: {path}')


def pages(path, auth, **params):
    after = None
    while True:
        q = dict(params, limit=100)
        if after:
            q['starting_after'] = after
        r = stripe_get(path, auth, **q)
        yield from r['data']
        if not r['has_more']:
            return
        after = r['data'][-1]['id']


def invoice_subscription(inv):
    parent = (inv.get('parent') or {}).get('subscription_details') or {}
    return inv.get('subscription') or parent.get('subscription')


def main():
    load_env()
    key = os.environ.get('STRIPE_SECRET_KEY_LIVE') or os.environ['STRIPE_SECRET_KEY']
    auth = 'Basic ' + base64.b64encode((key + ':').encode()).decode()

    sessions = collections.Counter()
    for s in pages('checkout/sessions', auth):
        arm = (s.get('metadata') or {}).get(KEY)
        if not arm:
            continue
        sessions[(arm, 'started')] += 1
        if s.get('status') == 'complete':
            sessions[(arm, 'completed')] += 1

    subs, created = {}, []
    for s in pages('subscriptions', auth, status='all'):
        arm = (s.get('metadata') or {}).get(KEY)
        if arm:
            subs[s['id']] = (arm, s['customer'])
            created.append(s['created'])
    if not subs:
        print('No subscriptions in the test yet (is CHECKOUT_3DS_TEST=on?).')
        return
    first_ts = min(created) - 86400

    billed = collections.Counter()
    for inv in pages('invoices', auth, **{'created[gte]': first_ts}):
        sid = invoice_subscription(inv)
        if sid not in subs or inv['amount_due'] < 10000 or inv['billing_reason'] != 'subscription_cycle':
            continue
        arm = subs[sid][0]
        billed[(arm, 'billed')] += 1
        if inv['status'] == 'paid':
            billed[(arm, 'paid')] += 1
            if inv['attempt_count'] <= 1:
                billed[(arm, 'paid_first_try')] += 1

    customers = {cus: arm for arm, cus in subs.values()}
    risk = collections.Counter()
    for d in pages('disputes', auth, **{'created[gte]': first_ts}):
        cus = stripe_get('charges/' + d['charge'], auth).get('customer')
        if cus in customers:
            risk[(customers[cus], 'disputes')] += 1
    for e in pages('radar/early_fraud_warnings', auth, **{'created[gte]': first_ts}):
        cus = stripe_get('charges/' + e['charge'], auth).get('customer')
        if cus in customers:
            risk[(customers[cus], 'fraud_warnings')] += 1

    n_subs = collections.Counter(arm for arm, _ in subs.values())
    for arm, label in (('A', 'A (normal)'), ('B', 'B (3DS)')):
        started, done = sessions[(arm, 'started')], sessions[(arm, 'completed')]
        b, paid, first = billed[(arm, 'billed')], billed[(arm, 'paid')], billed[(arm, 'paid_first_try')]
        n = n_subs[arm] or 1
        print(f'\n{label}')
        print(f'  checkout completed: {done}/{started} = {done / max(started, 1):.1%}')
        print(f'  subscribers: {n_subs[arm]}')
        print(f'  $160 charged: {b}, paid first try {first} ({first / max(b, 1):.1%}), paid eventually {paid} ({paid / max(b, 1):.1%})')
        print(f"  disputes: {risk[(arm, 'disputes')]} ({risk[(arm, 'disputes')] / n:.1%} of subscribers)")
        print(f"  fraud warnings: {risk[(arm, 'fraud_warnings')]} ({risk[(arm, 'fraud_warnings')] / n:.1%} of subscribers)")
    print('\nSmall groups swing a lot: wait for a few hundred charged trials per group before trusting approval differences.')


if __name__ == '__main__':
    main()
