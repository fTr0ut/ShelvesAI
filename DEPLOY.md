# ShelvesAI Deploy Guide

Last updated: 2026-02-08 18:13:21 UTC

This guide reflects the current stack: Express API + PostgreSQL + Expo mobile + optional admin dashboard.

## Core Components

- API: `api/` (Node/Express)
- Database: PostgreSQL
- Mobile client: `mobile/` (Expo)
- Admin dashboard: `admin-dashboard/` (Vite)

## API Deployment

Use any Node host (Render, Railway, Fly, VM, container platform).

Required environment groups:

- Auth/security: `JWT_SECRET`, `COOKIE_SECRET` (recommended)
- Database: `DATABASE_URL` or individual `POSTGRES_*` vars
- Media (optional S3): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_PUBLIC_URL`
- Provider keys as needed (TMDB, Google, Resend, etc.)

Typical commands:

```bash
cd api
npm install
npm run dev    # development
npm start      # production
```

## Database Migrations

Run migrations before first production traffic:

```bash
cd api
npx knex migrate:latest
```

Useful maintenance scripts:

```bash
npm run backfill:feed-aggregates
npm run backfill:feed-payloads
npm run cache-covers
```

## Mobile Release Notes

- Configure API base via Expo env/config.
- Build and submit with EAS when publishing.

## Security Basics

- Keep `.env` out of git.
- Do not use fallback/default secrets in production.
- Restrict catalog write/admin routes appropriately.
