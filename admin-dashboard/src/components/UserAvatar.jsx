const DEFAULT_ALLOWED_AVATAR_HOSTS = [
  'lh3.googleusercontent.com',
  'secure.gravatar.com',
  'gravatar.com',
];

function parseAllowedAvatarHosts() {
  const configured = String(import.meta.env.VITE_ALLOWED_IMAGE_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  let apiHost = null;
  try {
    if (import.meta.env.VITE_API_URL) {
      apiHost = new URL(import.meta.env.VITE_API_URL).host.toLowerCase();
    }
  } catch (_err) {
    apiHost = null;
  }

  const sameOriginHost =
    typeof window !== 'undefined' ? window.location.host.toLowerCase() : null;

  return new Set(
    [...DEFAULT_ALLOWED_AVATAR_HOSTS, ...configured, apiHost, sameOriginHost].filter(Boolean)
  );
}

const ALLOWED_AVATAR_HOSTS = parseAllowedAvatarHosts();

export function getSafeAvatarUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_AVATAR_HOSTS.has(parsed.host.toLowerCase())) return null;
    return parsed.toString();
  } catch (_err) {
    return null;
  }
}

/**
 * Static size-to-class mapping to prevent Tailwind from purging dynamic classes.
 * Add entries here when new sizes are needed.
 */
const SIZE_CLASS_MAP = {
  8: 'h-8 w-8',
  10: 'h-10 w-10',
  12: 'h-12 w-12',
  16: 'h-16 w-16',
  20: 'h-20 w-20',
};

/**
 * Renders a user avatar image, falling back to a placeholder with the user's initial.
 *
 * Props:
 *   user      {object}          user object with `picture` and `username` fields
 *   size      {number|string}   numeric size key from SIZE_CLASS_MAP (default 10)
 *   textSize  {string}          Tailwind text size class for the fallback initial (default "")
 */
export default function UserAvatar({ user, size = 10, textSize = '' }) {
  const safeAvatarUrl = getSafeAvatarUrl(user?.picture);
  const sizeClasses = SIZE_CLASS_MAP[size] ?? SIZE_CLASS_MAP[10];
  const textClass = textSize ? ` ${textSize}` : '';

  if (safeAvatarUrl) {
    return (
      <img
        className={`${sizeClasses} rounded-full object-cover`}
        src={safeAvatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className={`${sizeClasses} rounded-full bg-gray-300 flex items-center justify-center`}>
      <span className={`text-gray-600 font-medium${textClass}`}>
        {user?.username?.[0]?.toUpperCase() || '?'}
      </span>
    </div>
  );
}
