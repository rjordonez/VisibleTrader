import { supabase } from '../lib/supabase'

/** Own a feed channel only while this browser tab is visible. */
export function subscribeWhileVisible(
  createChannel: () => ReturnType<typeof supabase.channel>,
  onConnected: () => void,
) {
  let channel: ReturnType<typeof supabase.channel> | null = null
  let removing = false
  let disposed = false

  function sync() {
    const wanted = !disposed && document.visibilityState === 'visible'
    if (!wanted && channel) {
      const previous = channel
      channel = null
      removing = true
      // Finish leaving before rejoining the same topic after a quick tab switch.
      void supabase.removeChannel(previous).finally(() => {
        removing = false
        sync()
      })
    } else if (wanted && !channel && !removing) {
      const next = createChannel()
      channel = next
      next.subscribe(status => {
        if (status === 'SUBSCRIBED' && channel === next && !disposed
          && document.visibilityState === 'visible') {
          // Fetch after joining too, covering changes during reconnection.
          onConnected()
        }
      })
    }
  }

  document.addEventListener('visibilitychange', sync)
  sync()
  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', sync)
    sync()
  }
}
