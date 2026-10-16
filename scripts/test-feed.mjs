// Real React components, synthetic API responses, no account or production data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const baseline = process.env.FEED_TEST_BASELINE_REF
const originHost = 'feed-regression.supabase.co'
const server = await createServer({
  configFile: false,
  plugins: [react(), {
    name: 'feed-regression',
    enforce: 'pre',
    // Optional red check against the branch's unchanged parent implementation.
    load(id) {
      if (baseline && ['/src/app/useHomeTrades.ts', '/src/app/HomePage.tsx'].some(path => id.endsWith(path))) {
        return execFileSync('git', ['show', `${baseline}:${id.slice(id.indexOf('/src/') + 1)}`], { encoding: 'utf8' })
      }
    },
    configureServer(vite) {
      vite.middlewares.use('/__feed-regression', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/__feed-regression', '<!doctype html><div id="root"></div><script type="module" src="/scripts/fixtures/feed-regression.tsx"></script>'))
      })
    },
  }],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(`https://${originHost}`),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('synthetic-public-key'),
    'import.meta.env.VITE_POSTHOG_PROJECT_TOKEN': JSON.stringify('synthetic-project-token'),
    'import.meta.env.VITE_POSTHOG_HOST': JSON.stringify('https://analytics.invalid'),
  },
  server: { host: '127.0.0.1', port: 0 },
})
let browser
const wallet = `0x${'a'.repeat(40)}`
const record = { wallet, wallet_name: 'Test Trader', won: 15, lost: 5, net_profit: 100 }
const trade = id => ({ id, condition_id: `condition-${id}`, wallet, wallet_name: 'Test Trader', title: `Synthetic market ${id}`, outcome: 'Yes', side: 'BUY', usd: 250, price: 0.5, ts: new Date().toISOString(), epoch: Date.now() / 1000, slug: `test-${id}`, category: 'sports' })

try {
  await server.listen()
  const port = server.httpServer.address().port
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } })
    let fail = false
    let ids = [1]
    let followingDelay = 0
    const errors = []
    await context.routeWebSocket(/supabase/, ws => ws.close())
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') return route.continue()
      const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      if (url.hostname !== originHost) return send({})
      if (url.pathname === '/rest/v1/leaderboard') {
        await new Promise(resolve => setTimeout(resolve, followingDelay || 800))
        return fail ? send({ message: 'Synthetic outage' }, 503) : send([record])
      }
      if (url.pathname === '/rest/v1/ticker') return send(ids.map(trade))
      if (url.pathname.includes('tracked_trade_count')) return send(100)
      return send([])
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (/Maximum update depth exceeded/.test(message.text())) errors.push(message.text())
    })
    await page.goto(`http://127.0.0.1:${port}/__feed-regression`)
    await page.getByLabel('Loading trades', { exact: true }).waitFor()
    await page.getByText('Synthetic market 1', { exact: true }).waitFor({ timeout: 10000 })
    assert.deepEqual(errors, [], 'slow first load does not crash')

    // Empty following feed is immediate; switching back must stay responsive.
    await page.getByRole('button', { name: /^Following/ }).click()
    await page.getByRole('heading', { name: 'Who are you watching?' }).waitFor()
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    await page.getByText('Synthetic market 1', { exact: true }).waitFor()

    // Adding a wallet switches the actual hook key. Resolve the old request last.
    await page.getByRole('button', { name: 'Follow Test Trader', exact: true }).click()
    followingDelay = 1600
    await page.getByRole('button', { name: /^Following/ }).click()
    await page.getByLabel('Loading trades', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Discover', exact: true }).click()
    followingDelay = 0
    await page.getByText('Synthetic market 1', { exact: true }).waitFor()

    // Visibility refresh uses the real subscription; errors retain old content.
    fail = true
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByText(/Unable to refresh trades/).waitFor()
    assert.equal(await page.getByText('Synthetic market 1', { exact: true }).count(), 1)
    fail = false
    ids = [2, 1]
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByText('Synthetic market 2', { exact: true }).waitFor()

    // Preserve feed freezing below the fold, then reveal queued new trades.
    await page.evaluate(() => {
      document.body.style.minHeight = '3000px'
      window.scrollTo(0, 600)
      window.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(50)
    ids = [3, 2, 1]
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.getByRole('button', { name: '1 new trade', exact: true }).waitFor()
    assert.equal(await page.getByText('Synthetic market 3', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '1 new trade', exact: true }).click()
    await page.getByText('Synthetic market 3', { exact: true }).waitFor()
    assert.deepEqual(errors, [], 'no uncaught errors throughout feed transitions')
    console.log(`PASS ${width}px: slow load, empty following, rapid switching, failed refresh, recovery, live updates, scroll freeze`)
    await context.close()
  }
} finally {
  await browser?.close()
  await server.close()
}
