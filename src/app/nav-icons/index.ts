// Which sidebar ids have an animated Lordicon (system / outline family —
// simple, even weight, a gentle 1s pinch on hover). The JSON files are
// code-split — LordIcon.tsx dynamically imports <id>.json on first hover,
// so nothing here weighs on the app chunk. An id not in this set falls
// back to its Lucide icon.
//
// Sources (verify each is on Lordicon's FREE tier and add an attribution
// line before shipping; swap any that turn out to be premium):
//   home        system-outline-63-home
//   search      system-outline-19-magnifier
//   signals     system-outline-1043-signal
//   terminal    system-outline-3089-bar-chart-vertical
//   profits     system-outline-4224-line-graph-arrow-up
//   leaderboard system-outline-433-trophy-star
//   journal     system-outline-28-calendar
//
// To change one: grab a new icon on lordicon.com, Download → Lottie JSON,
// overwrite <id>.json here.
export const navIconIds = new Set<string>([
  'home',
  'search',
  'signals',
  'terminal',
  'profits',
  'leaderboard',
  'journal',
])
