import { createContext, useContext } from 'react'

// Lets AppShell (and anything nested under it) know whether the signed-in
// user has an active subscription, without ProtectedRoute needing to know
// anything about how AppShell chooses to render that — it always renders
// the real app now, `locked` just tells the shell to blur it and show a
// buy-to-see overlay instead of blocking the route entirely. Default value
// (locked: false) only matters for stray usages outside a real provider —
// every real render path always has one, since ProtectedRoute mounts it
// as soon as `subActive` stops being null.
export const SubscriptionGateContext = createContext({ locked: false })
export const useSubscriptionGate = () => useContext(SubscriptionGateContext)
