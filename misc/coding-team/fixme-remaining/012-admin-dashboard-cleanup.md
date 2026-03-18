# 012 — Admin Dashboard Cleanup: Pagination, Avatar, Error Util

## Context

Three duplication patterns in the admin dashboard:

1. **DUP-7**: Pagination controls in `Users.jsx` (~lines 113-157) are nearly identical for mobile and desktop responsive views.
2. **DUP-8**: User avatar rendering (image or placeholder with initial) and status badges (suspended/active/admin/premium) are duplicated between `UserDetailModal.jsx` and `UserTable.jsx`.
3. **DUP-9**: API error extraction pattern `catch (err) { setError(err.response?.data?.error || 'Generic message') }` repeated 7+ times across `Dashboard.jsx`, `Users.jsx`, `UserDetailModal.jsx`.

## Objective

Extract shared components and utilities to eliminate duplication.

## Scope

### DUP-7: Create `admin-dashboard/src/components/Pagination.jsx`

Extract a shared `<Pagination>` component that handles:
- Page navigation (prev/next)
- Page number display
- Responsive layout (mobile vs desktop)
- Props: `page`, `totalPages`, `onPageChange`, optional `className`

Update `Users.jsx` to use it.

### DUP-8: Create shared avatar and badge components

- `admin-dashboard/src/components/UserAvatar.jsx` — renders user image or placeholder with initial
- `admin-dashboard/src/components/UserBadge.jsx` — renders status badges (suspended, active, admin, premium)

Update:
- `admin-dashboard/src/components/UserDetailModal.jsx`
- `admin-dashboard/src/components/UserTable.jsx`

### DUP-9: Create `admin-dashboard/src/utils/errorUtils.js`

```javascript
export function getErrorMessage(err, fallback = 'An unexpected error occurred') {
  return err.response?.data?.error || err.message || fallback;
}
```

Update all catch blocks in:
- `Dashboard.jsx`
- `Users.jsx`
- `UserDetailModal.jsx`

## Non-goals

- Do not change styling or visual appearance.
- Do not add new features to the admin dashboard.
- Do not change the admin API client.

## Constraints

- The admin dashboard uses React 18, Vite, Tailwind. Keep components consistent with existing patterns.
- Pagination component should be a controlled component (page state managed by parent).
- Badge component should accept a `user` object and render all applicable badges.
