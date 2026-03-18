# CLAUDE.md

Last updated: 2026-02-08 18:13:21 UTC

This file gives quick repo context to coding agents.

## Project Snapshot

ShelvesAI is a mobile-first app for cataloging physical collections, with social feed and discovery.

Runtime components:

- `mobile/`: Expo React Native app
- `api/`: Express API, PostgreSQL query layer, vision/catalog integrations
- `admin-dashboard/`: Admin and moderation UI

## Common Commands

### API

```bash
cd api
npm install
npm run dev
npm run test:backend
```

### Database

```bash
cd api
npx knex migrate:latest
```

### Mobile

```bash
cd mobile
npm install
npx expo start
```

### Admin Dashboard

```bash
cd admin-dashboard
npm install
npm run dev
```

## Architecture Notes

- Auth: local JWT (`/api/auth/*`) plus admin login (`/api/admin/login`).
- Data store: PostgreSQL.
- Feed: aggregate model (`event_logs` + `event_aggregates`).
- Vision: async job flow on `/api/shelves/:shelfId/vision`.
- Premium behavior: currently user-controlled `is_premium` toggle in account settings by design.

## Core Docs

- `README.md`
- `FIXME.md`
- `AGENTS/workflow.md`
- `AGENTS/api_routes.md`
- `AGENTS/authentication-onboarding.md`
- `AGENTS/admin-system.md`
- `AGENTS/DependencyTree.md` — Full dependency tree for all components. **Agents must update this file when adding/removing/renaming files or changing imports.**
- `docs/api-compliance.md`
