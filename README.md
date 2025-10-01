# Collector Monorepo

This repository contains the Collector Express API, the Vite-powered web client,
an Expo mobile shell, and a dedicated Next.js app that hosts Plasmic Studio.
The sections below outline local development commands.

## Vite frontend (React)

The Vite app lives in `frontend/`. Common commands:

```bash
cd frontend
npm install
npm run dev     # starts Vite on http://localhost:5173
npm run build   # creates production bundle in dist/
```

## Express backend

The backend lives in `backend/` and defaults to port `5001` during development.

```bash
cd backend
npm install
npm run dev     # or use `npm run server` from the repo root
```

## Plasmic Studio host (Next.js)

Designers can work against live API data by running the backend alongside the
Next.js host found in `plasmic-host/`.

```bash
cd plasmic-host
npm install
npm run dev     # starts Next.js on http://localhost:3002 by default
```

Create `plasmic-host/.env.local` with the following values so the host knows how
to talk to the Express API and which Plasmic projects to load:

```
PLASMIC_BACKEND_ORIGIN=http://localhost:5001
NEXT_PUBLIC_PLASMIC_PROJECTS=[{"id":"<project-id>","token":"<public-token>"}]
# Optional explicit origin override for the host URL shown in Studio
NEXT_PUBLIC_PLASMIC_HOST_URL=http://localhost:3002/plasmic-host
```

Both the Next.js API route (`/plasmic-loader.json`) and the client runtime set
`credentials: 'include'` when contacting the Express backend. This keeps cookie
based authentication working inside Plasmic Studio.

### Combined workflow

From the repository root you can run all services together:

```bash
# Install dependencies once
npm install

# In separate terminals
npm run server                # backend on http://localhost:5001
cd frontend && npm run dev    # Vite frontend
cd plasmic-host && npm run dev   # Plasmic Studio host
```

When pointing Plasmic Studio to the local host URL, designers will be able to
preview pages that rely on cookie-authenticated backend requests.
