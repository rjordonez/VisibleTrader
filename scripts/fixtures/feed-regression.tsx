import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import HomePage from '../../src/app/HomePage'
import { useAlerts } from '../../src/app/useAlerts'

export default function FeedHarness() {
  return <HomePage alerts={useAlerts()} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><FeedHarness /></BrowserRouter></StrictMode>,
)
