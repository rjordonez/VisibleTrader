import posthog from 'posthog-js'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

const projectToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN
const host = import.meta.env.VITE_POSTHOG_HOST

const identifyUser = (user: User) => {
  posthog.identify(user.id, {
    ...(user.email ? { email: user.email } : {}),
  })
}

if (!projectToken || !host) {
  if (import.meta.env.DEV) {
    const missingVariable = !projectToken
      ? 'VITE_POSTHOG_PROJECT_TOKEN'
      : 'VITE_POSTHOG_HOST'
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    )
  }
} else {
  posthog.init(projectToken, {
    api_host: host,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  })

  void supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) identifyUser(session.user)
  })

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      identifyUser(session.user)
    } else if (event === 'SIGNED_OUT') {
      posthog.reset()
    }
  })
}

export default posthog
