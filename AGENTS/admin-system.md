# Admin System

Last updated: 2026-02-08 18:13:21 UTC

## Scope

The admin system is a separate moderation surface backed by `/api/admin/*` plus the `admin-dashboard/` web app.

## Data Model

User flags in `users` table:

- `is_admin`
- `is_suspended`
- `suspended_at`
- `suspension_reason`

Audit table:

- `admin_action_logs`
  - `admin_id`
  - `action`
  - `target_user_id`
  - `metadata`
  - `ip_address`
  - `user_agent`
  - `created_at`

## API Access Control

- `POST /api/admin/login` is public and rate limited.
- All other admin routes enforce:
  1. `auth` middleware
  2. `requireAdmin` middleware
  3. admin route rate limiter

## Admin Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/stats` | Dashboard counts |
| GET | `/api/admin/users` | Search/filter user list |
| GET | `/api/admin/users/:userId` | Detailed user info |
| POST | `/api/admin/users/:userId/suspend` | Suspend account |
| POST | `/api/admin/users/:userId/unsuspend` | Remove suspension |
| POST | `/api/admin/users/:userId/toggle-admin` | Grant/revoke admin |
| GET | `/api/admin/feed/recent` | Recent aggregate activity |
| GET | `/api/admin/system` | Runtime health metrics |

## Suspension Behavior

- Suspended users are blocked by `auth` middleware with:
  - HTTP 403
  - `code: ACCOUNT_SUSPENDED`
- In `optionalAuth`, suspended users are treated as unauthenticated.

## Audit Logging

These actions write to `admin_action_logs`:

- suspend user
- unsuspend user
- grant admin
- revoke admin

Self-protection rules:

- admin cannot suspend self
- admin cannot remove own admin role

## Dashboard App

`admin-dashboard/` stack:

- React 18
- Vite
- React Router
- Axios
- Tailwind

Expected env:

- `VITE_API_URL` pointing to API root (for example `http://localhost:5001/api`).

## Remaining Improvements

Tracked in `FIXME.md` and ongoing hardening:

- stronger role granularity (super-admin model)
- optional MFA for admin accounts
- explicit admin session lifecycle controls
