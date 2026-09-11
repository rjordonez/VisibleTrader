"""Read-only field audit of the single saved US connection; no credentials printed."""
import base64
import json
import os
import subprocess
import time
from collections import Counter

import psycopg
import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from _env import load_env


def main():
    load_env()
    with psycopg.connect(os.environ['DATABASE_URL'], prepare_threshold=None) as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        rows = conn.execute('SELECT key_id, ciphertext FROM public.polymarket_us_connections LIMIT 2').fetchall()
    if len(rows) != 1:
        print('Expected exactly one connection; audit stopped.')
        return
    process = subprocess.run(['gcloud', 'run', 'services', 'describe', 'polymarket-us-kms-proxy', '--region', 'us-central1', '--project', 'project-6595d7ba-ffa9-4323-953', '--format=json'], capture_output=True, text=True, check=True)
    service = json.loads(process.stdout)
    env = {item['name']: item.get('value') for item in service['spec']['template']['spec']['containers'][0]['env']}
    response = requests.post(service['status']['url'] + '/decrypt', headers={'Authorization': 'Bearer ' + env['PROXY_SHARED_SECRET']}, json={'ciphertext': rows[0][1]}, timeout=15)
    response.raise_for_status()
    signer = Ed25519PrivateKey.from_private_bytes(base64.b64decode(response.json()['plaintext'])[:32])
    path = '/v1/portfolio/activities'
    stamp = str(int(time.time() * 1000))
    signature = base64.b64encode(signer.sign((stamp + 'GET' + path).encode())).decode()
    response = requests.get('https://api.polymarket.us' + path, params={'limit': 100}, headers={'X-PM-Access-Key': rows[0][0], 'X-PM-Timestamp': stamp, 'X-PM-Signature': signature}, timeout=15)
    response.raise_for_status()
    payload = response.json()
    items = payload.get('activities', [])
    print(json.dumps({'count': len(items), 'eof': payload.get('eof'), 'has_cursor': bool(payload.get('nextCursor')), 'types': dict(Counter(item.get('type') for item in items))}))
    for item in items[:30]:
        out = {'type': item.get('type')}
        for name in ['trade', 'positionResolution']:
            value = item.get(name)
            if not isinstance(value, dict):
                continue
            out[name + '_keys'] = list(value)
            out[name] = {key: value.get(key) for key in ['createTime', 'updateTime', 'price', 'qtyDecimal', 'costBasis', 'realizedPnl', 'side', 'state'] if key in value}
            for field in ['beforePosition', 'afterPosition']:
                if isinstance(value.get(field), dict):
                    out[field] = {key: value[field].get(key) for key in ['realized', 'cost', 'netPositionDecimal', 'expired']}
        print(json.dumps(out))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__)
        raise SystemExit(1)
