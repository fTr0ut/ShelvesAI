/**
 * Renders status/role badges for a user.
 *
 * Props:
 *   user    {object}  user object with isSuspended, isAdmin, isPremium fields
 *   variant {string}  "sm" (default, table rows) or "md" (detail modal)
 *
 * When variant="sm" the component renders individual badge elements suitable
 * for use in separate table cells (export named badges for granular use).
 * When variant="md" all applicable badges are rendered in a flex row.
 */

const BASE_CLASSES = 'font-semibold rounded-full';

const SIZE = {
  sm: 'px-2 inline-flex text-xs leading-5',
  md: 'px-3 py-1 text-sm',
};

export function SuspendedBadge({ isSuspended, variant = 'sm' }) {
  const size = SIZE[variant] ?? SIZE.sm;
  return isSuspended ? (
    <span className={`${size} ${BASE_CLASSES} bg-red-100 text-red-800`}>Suspended</span>
  ) : (
    <span className={`${size} ${BASE_CLASSES} bg-green-100 text-green-800`}>Active</span>
  );
}

export function AdminBadge({ isAdmin, variant = 'sm' }) {
  const size = SIZE[variant] ?? SIZE.sm;
  return isAdmin ? (
    <span className={`${size} ${BASE_CLASSES} bg-purple-100 text-purple-800`}>Admin</span>
  ) : (
    <span className={`${size} ${BASE_CLASSES} bg-gray-100 text-gray-800`}>User</span>
  );
}

export function PremiumBadge({ variant = 'sm' }) {
  const size = SIZE[variant] ?? SIZE.sm;
  return (
    <span className={`${size} ${BASE_CLASSES} bg-yellow-100 text-yellow-800`}>Premium</span>
  );
}

/**
 * Renders all applicable badges for a user in a flex row.
 * Intended for the detail modal (variant="md") or anywhere all badges are shown together.
 */
export default function UserBadge({ user, variant = 'md' }) {
  return (
    <div className="flex gap-2">
      <SuspendedBadge isSuspended={user.isSuspended} variant={variant} />
      {user.isAdmin && <AdminBadge isAdmin variant={variant} />}
      {user.isPremium && <PremiumBadge variant={variant} />}
    </div>
  );
}
