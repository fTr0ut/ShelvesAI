# Plasmic Host (Next.js)

This app exposes the minimal endpoints Plasmic Studio requires when working with
code components that rely on the Collector Express backend.

## Available routes

- `/plasmic-host` – Canvas host for Plasmic Studio.
- `/plasmic-loader.json` – Loader configuration consumed by the Plasmic Studio
  UI and the loader runtime.

## Environment variables

Create a `.env.local` file with the following values:

```
# Express API origin used for proxying loader configuration.
PLASMIC_BACKEND_ORIGIN=http://localhost:5001

# Either provide a JSON array of projects...
NEXT_PUBLIC_PLASMIC_PROJECTS=[{"id":"<project-id>","token":"<public-token>"}]
# ...or the individual values below:
NEXT_PUBLIC_PLASMIC_PROJECT_ID=<project-id>
NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN=<public-token>

# Optional explicit host URL (defaults to `${origin}/plasmic-host`).
NEXT_PUBLIC_PLASMIC_HOST_URL=http://localhost:3002/plasmic-host
```

When developing locally, run the Express backend from `backend/` as usual and
start this app with `npm run dev` inside `plasmic-host/`. See the repository
root README for combined dev workflows.
