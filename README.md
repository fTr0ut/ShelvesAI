# ShelvesAI

Last updated: 2026-02-08 18:13:21 UTC

Mobile-first app for cataloging and sharing physical collections.

## Architecture

- `mobile/`: Expo + React Native app
- `api/`: Node.js + Express API
- `api/database`: PostgreSQL schema, migrations, query modules
- `admin-dashboard/`: React + Vite admin web app
- `AGENTS/`: living architecture/process documentation

## Current Stack

- Auth: local JWT (`/api/auth/*`) plus admin JWT (`/api/admin/login`)
- Data store: PostgreSQL
- Vision: async job-based pipeline (`/api/shelves/:shelfId/vision`)
- Media: local cache or S3-backed storage (`/media/*` URLs resolved server-side)

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Expo tooling for mobile development

### API

```bash
cd api
npm install
npm run dev
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

## Documentation

- Route map: `AGENTS/api_routes.md`
- Workflow overview: `AGENTS/workflow.md`
- Auth/onboarding: `AGENTS/authentication-onboarding.md`
- Admin system: `AGENTS/admin-system.md`
- Compliance checklist: `docs/api-compliance.md`
- Audit TODOs: `FIXME.md`
- Historical plans archive: `AGENTS/storyboards/README.md`
