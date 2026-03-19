# Authentication and Onboarding

Last updated: 2026-02-08 18:13:21 UTC

## Auth Model

- JWT auth with `HS256` (`api/middleware/auth.js`).
- Password hashing with bcrypt in auth query layer.
- Auth middleware loads user flags (`is_premium`, `is_admin`, `is_suspended`) each request with a short in-memory cache.

## Public Auth Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/register` | Account creation |
| POST | `/api/auth/forgot-password` | Request reset email |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/validate-reset-token` | Check token validity |

Authenticated auth endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/username` | Set/change username |

Legacy aliases exist under `/api/*` because auth routes are mounted twice.

## Registration and Login Rules

- Registration requires `username`, `password`, `email`.
- Email is normalized to lowercase and must be valid format.
- Password minimum length is 8.
- Duplicate email/username is handled via DB unique constraints.
- Login returns suspended-user error when account is suspended.

## Password Reset Flow

1. `POST /api/auth/forgot-password` accepts email.
2. API always returns generic success message (anti-enumeration).
3. If user exists, token is created in `password_reset_tokens`.
4. Email service sends reset link via Resend to `RESET_PASSWORD_URL` (set this to website `/reset-password`).
5. Website reset page attempts deep-link to app (`NEXT_PUBLIC_RESET_DEEP_LINK_BASE`) and falls back to web form.
6. `POST /api/auth/reset-password` validates token and updates password hash.

Security note:

- Current fallback behavior logs reset tokens when the email provider key is not configured (`api/services/emailService.js`).
- This is tracked in `FIXME.md` and should be removed for non-dev usage.

## Onboarding Gate

Required profile fields:

- email
- firstName
- city
- state

Flow in app:

1. User authenticates.
2. App calls `GET /api/account`.
3. If required fields missing or onboarding flag false, user is routed through onboarding screens.
4. After profile fields are set, `POST /api/onboarding/complete` marks completion.

## Premium Flag Behavior

Current product decision:

- `is_premium` is user-controlled via account toggle (`PUT /api/account`), intentionally.
- Mobile stores/uses this flag to enable cloud vision mode.
- API vision route still enforces `req.user.isPremium` for cloud requests.

## Admin Authentication

- Admin login endpoint: `POST /api/admin/login`.
- It validates credentials and admin status.
- Admin API routes require both:
  - valid JWT
  - `req.user.isAdmin === true`
