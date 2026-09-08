import { avatarGradient } from './helpers'

// User avatar: the VisibleTrader goggles mark on a vibrant per-user
// background, colour picked deterministically from the user id (reuses the
// same palette/hash as trader avatars via avatarGradient). Replaces the
// bare initial — every account gets a recognisable, on-brand pfp without
// needing an uploaded photo.
export default function GogglesAvatar({ id, className = '' }: { id: string | null; className?: string }) {
  return (
    <span className={`app-avatar app-avatar-goggles ${className}`} style={{ background: avatarGradient(id) }}>
      <svg viewBox="0 0 159 75" className="app-avatar-goggles-mark" aria-hidden="true">
        <path
          d="M38.9914 32.498C32.5691 38.0021 25.1226 48.7343 15.1622 55.224C11.3094 57.7343 9.14352 61.0649 13.1785 63.2705C23.4997 68.912 48.6107 74.7065 54.5 60.5C60.5108 46.0005 72.503 38.9998 83.503 36.4998C89.2046 35.204 102.625 48.8099 114.497 60.4554C123.854 69.6348 137.961 69.3431 146.948 59.8007C151.248 55.2356 153.948 51.7871 155.55 49.3577C157.565 46.3 155.19 45.5609 151.553 45.9863C136.527 47.7437 104.491 45.8832 93.503 30.4998C83.503 16.5 56.4914 17.5001 38.9914 32.498Z"
          fill="#0C2557"
        />
        <path
          d="M3 33V40C3 56.5685 16.4315 70 33 70H33.4905C44.2813 70 54.2408 64.2047 59.5726 54.8231L64.8179 45.5936C72.0889 32.7998 90.221 31.9744 98.6243 44.0547L108.965 58.92C113.794 65.8614 121.714 70 130.17 70C144.435 70 156 58.4353 156 44.1696V33C156 16.4315 142.569 3 126 3H33C16.4315 3 3 16.4315 3 33Z"
          fill="none"
          stroke="#ffffff"
          strokeWidth="9"
        />
      </svg>
    </span>
  )
}
