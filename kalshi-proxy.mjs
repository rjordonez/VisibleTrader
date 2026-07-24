import https from 'https'
import http from 'http'

const STRIP = new Set(['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user'])

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
    })
    res.end()
    return
  }

  const path = '/trade-api/v2' + (req.url ?? '/')
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => !STRIP.has(k.toLowerCase()))
  )
  headers['host'] = 'api.elections.kalshi.com'
  headers['accept-encoding'] = 'identity'

  const proxy = https.request(
    { hostname: 'api.elections.kalshi.com', path, method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, {
        'content-type': proxyRes.headers['content-type'] ?? 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      })
      proxyRes.pipe(res)
    }
  )
  proxy.on('error', (err) => {
    console.error('[kalshi-proxy]', err.message)
    res.writeHead(502)
    res.end(JSON.stringify({ error: err.message }))
  })
  req.pipe(proxy)
}).listen(5199, () => console.log('[kalshi-proxy] running on http://localhost:5199'))
