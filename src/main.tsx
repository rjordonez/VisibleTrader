import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import './lib/posthog.ts'
import './index.css'
import App from './App.tsx'

// Every route below App.tsx's top level is React.lazy()-loaded. A tab left
// open across a deploy still holds the old index.html's chunk hashes in
// memory; clicking into one of those routes later tries to fetch a JS file
// that no longer exists (replaced by the new deploy's differently-hashed
// one). Vercel's SPA catch-all rewrite serves index.html for that missing
// path instead of a 404, which surfaces as a "MIME type text/html" console
// error and a dead navigation -- Vite fires `vite:preloadError` for exactly
// this case. One reload fetches the current index.html/hashes and the
// click-through works. Reaching this line at all means the entry bundle
// itself just loaded fine, so clearing the guard here (not just setting it
// on error) lets a distinct, later preload error -- after some future
// deploy, same long-lived tab -- also self-heal once, while still stopping
// an immediate reload loop if the reload didn't actually fix it (a real
// broken deploy, not a stale tab).
const RELOAD_GUARD_KEY = 'vt_reloaded_after_preload_error'
sessionStorage.removeItem(RELOAD_GUARD_KEY)
window.addEventListener('vite:preloadError', (event) => {
  // Otherwise Vite also logs its own uncaught-error console noise for this
  // on top of the reload we're already doing to handle it.
  event.preventDefault()
  if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return
  sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <Analytics />
  </StrictMode>,
)
