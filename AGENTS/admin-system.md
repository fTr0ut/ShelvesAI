# Admin System Documentation

This document describes the admin privileges system and dashboard implementation in ShelvesAI.

## Overview

The admin system provides a separate web dashboard for managing users, monitoring system health, and performing moderation actions. It consists of:

1. **Database schema additions** - `is_admin` and `is_suspended` flags on users table
2. **Audit logging** - `admin_action_logs` table for admin activity
3. **API endpoints** - Protected admin routes at `/api/admin/*`
4. **Admin middleware** - Authorization layer requiring `isAdmin` flag
5. **Web dashboard** - React/Vite app with Tailwind CSS

---

## Database Schema

### Migration: `20260127000000_add_admin_suspension_flags.js`

Adds the following columns to the `users` table:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `is_admin` | boolean | false | Grants admin dashboard access |
| `is_suspended` | boolean | false | Blocks user from API access |
| `suspended_at` | timestamp | null | When suspension was applied |
| `suspension_reason` | text | null | Optional reason for suspension |

**Index**: Partial index on `is_suspended` WHERE `is_suspended = true` for efficient lookup of suspended users.

### Migration: `20260127010000_add_admin_action_logs.js`

Adds audit logging for admin actions:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `admin_id` | UUID | null | Admin who performed the action |
| `action` | text | - | Action name (`USER_SUSPENDED`, `USER_UNSUSPENDED`, `ADMIN_GRANTED`, `ADMIN_REVOKED`) |
| `target_user_id` | UUID | null | Affected user |
| `metadata` | jsonb | `{}` | Additional context (e.g., suspension reason) |
| `ip_address` | text | null | Admin client IP (best-effort) |
| `user_agent` | text | null | Admin user agent |
| `created_at` | timestamptz | now | Action timestamp |

---

## API Endpoints

All admin endpoints are mounted at `/api/admin` and require:
1. Valid JWT authentication (`auth` middleware)
2. `isAdmin = true` on the user (`requireAdmin` middleware)

### Admin Login
```
POST /api/admin/login
```
Authenticate an admin user and return a short-lived admin token.

### Dashboard Statistics
```
GET /api/admin/stats
```
Returns aggregate counts:
- `totalUsers` - All registered users
- `totalShelves` - All shelves created
- `totalCollections` - All items in collections
- `suspendedUsers` - Currently suspended users
- `adminUsers` - Users with admin privileges
- `newUsersLast7Days` - Recent registrations

### User Management
```
GET /api/admin/users
```
List users with pagination, search, and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Results per page (max 100) |
| `offset` | number | 0 | Pagination offset |
| `search` | string | - | Search username, email, first/last name |
| `sortBy` | string | `created_at` | Sort column (`created_at`, `username`, `email`) |
| `sortOrder` | string | `desc` | Sort direction (`asc`, `desc`) |
| `suspended` | string | - | Filter by suspension status (`true`/`false`) |
| `admin` | string | - | Filter by admin status (`true`/`false`) |

```
GET /api/admin/users/:userId
```
Get detailed user info including:
- Profile data (username, email, name, location, bio)
- Status flags (admin, suspended, premium, private)
- Counts (shelves, items, friends)
- Suspension details if applicable

```
POST /api/admin/users/:userId/suspend
```
Suspend a user account.

**Body:**
```json
{
  "reason": "Optional suspension reason"
}
```

**Safeguards:**
- Cannot suspend yourself

```
POST /api/admin/users/:userId/unsuspend
```
Remove suspension from a user account.

```
POST /api/admin/users/:userId/toggle-admin
```
Toggle admin privileges for a user.

**Safeguards:**
- Cannot modify your own admin status

### Activity Monitoring
```
GET /api/admin/feed/recent
```
Get recent activity feed entries for moderation purposes.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Results per page (max 200) |
| `offset` | number | 0 | Pagination offset |

### System Info
```
GET /api/admin/system
```
Returns server health metrics:
- `uptime` - Server uptime in seconds
- `memory.heapUsed` - Heap memory in MB
- `memory.heapTotal` - Total heap in MB
- `memory.rss` - RSS memory in MB
- `nodeVersion` - Node.js version
- `platform` - OS platform

---

## Middleware

### Auth Middleware (`api/middleware/auth.js`)

The standard `auth` middleware:
1. Validates JWT token
2. Fetches user from database including `is_admin` and `is_suspended`
3. **Blocks suspended users** with 403 status and `ACCOUNT_SUSPENDED` code
4. Sets `req.user.isAdmin` for downstream use

### Admin Middleware (`api/middleware/admin.js`)

The `requireAdmin` middleware:
1. Verifies `req.user` exists (user is authenticated)
2. Checks `req.user.isAdmin === true`
3. Returns 403 if not an admin

**Usage in routes:**
```javascript
router.use(auth);        // First authenticate
router.use(requireAdmin); // Then verify admin status
```

---

## Admin Dashboard

### Stack
- React 18 with Vite
- Tailwind CSS for styling
- React Router for navigation
- Axios for API calls

### Directory Structure
```
admin-dashboard/
├── src/
│   ├── api/
│   │   └── client.js          # Axios client with auth interceptors
│   ├── components/
│   │   ├── Layout.jsx         # Main layout with sidebar
│   │   ├── Sidebar.jsx        # Navigation sidebar
│   │   ├── StatsCard.jsx      # Dashboard stat display
│   │   ├── UserTable.jsx      # User list table
│   │   └── UserDetailModal.jsx # User management modal
│   ├── context/
│   │   └── AuthContext.jsx    # Authentication state
│   ├── pages/
│   │   ├── Login.jsx          # Admin login form
│   │   ├── Dashboard.jsx      # Stats and system info
│   │   ├── Users.jsx          # User management page
│   │   └── Settings.jsx       # Admin settings
│   ├── App.jsx               # Routes and protected routes
│   └── main.jsx              # Entry point
├── .env.example              # Environment template
└── package.json
```

### Authentication Flow

1. Admin logs in via `/login` page using existing app credentials
2. JWT token stored in `sessionStorage` as `adminToken`
3. Axios interceptor attaches token to all requests
4. 401 responses clear token and redirect to login

**Note**: The dashboard uses the `/api/admin/login` endpoint. Users must have `is_admin = true` in the database to access admin endpoints after login.

### Pages

#### Dashboard (`/`)
- Stats cards showing user/shelf/item counts
- System status panel with uptime and memory usage

#### Users (`/users`)
- Searchable, filterable user table
- Click user to open detail modal
- Pagination with 20 users per page

#### User Detail Modal
- Full user profile information
- Status badges (Active/Suspended, Admin, Premium)
- Account statistics (shelves, items, friends)
- Suspension info with reason and timestamp
- Actions: Suspend/Unsuspend, Grant/Remove Admin

---

## Creating Admin Users

### Via Script
```bash
cd api
node scripts/create-admin.js <email>
```

Example:
```bash
node scripts/create-admin.js admin@example.com
```

### Via Database
```sql
UPDATE users SET is_admin = true WHERE email = 'admin@example.com';
```

### Via Another Admin
Use the "Make Admin" button in the User Detail modal.

---

## Suspension Behavior

When a user is suspended:

1. **API Access**: All authenticated requests return 403 with:
   ```json
   {
     "error": "Account suspended",
     "code": "ACCOUNT_SUSPENDED",
     "reason": "Reason if provided"
   }
   ```

2. **Optional Auth**: Suspended users treated as unauthenticated (content visible but no user-specific data)

3. **Admin Dashboard**: Suspended users appear with red "Suspended" badge, reason displayed in detail modal

---

## Security Considerations

### Current Implementation
- Admin routes protected by middleware chain
- Self-modification prevented (can't suspend/demote yourself)
- JWT tokens validated on every request
- Suspended users immediately locked out

### Recommendations for Production

1. **Audit Logging**: Log all admin actions (suspend/unsuspend/toggle-admin) with timestamp and acting admin
2. **Super Admin Role**: Consider a higher privilege level that cannot be toggled by regular admins
3. **Rate Limiting**: Add rate limiting to admin endpoints
4. **Session Management**: Track active admin sessions, ability to force logout
5. **Two-Factor Auth**: Require 2FA for admin accounts
6. **IP Allowlisting**: Optionally restrict admin access by IP

---

## Environment Variables

### API Server
No additional variables required. Admin functionality uses existing `JWT_SECRET` and database connection.

### Admin Dashboard
```env
VITE_API_URL=http://localhost:5001/api
```

---

## Running the Dashboard

```bash
cd admin-dashboard
npm install
npm run dev    # Development server at http://localhost:5173
npm run build  # Production build
```

For production, serve the built files from `admin-dashboard/dist/` via a static file server or CDN. Ensure the API URL is configured correctly.
