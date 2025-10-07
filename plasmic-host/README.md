# Plasmic Host (React + Vite)

This app exposes the minimal routes Plasmic Studio requires when working with
code components that rely on the Collector Express backend.

## Available routes

- `/plasmic-host` – Canvas host for Plasmic Studio.
- `/plasmic-loader.json` – Loader configuration consumed by Plasmic Studio and the loader runtime.

The Express backend now serves the Plasmic host directly; you no longer need to
run a separate Next.js server.

## Environment variables

Create a `.env.local` file with the following values:

```
# Express API origin used for loader configuration.
PLASMIC_BACKEND_ORIGIN=http://localhost:5001

# Either provide a JSON array of projects...
NEXT_PUBLIC_PLASMIC_PROJECTS=[{"id":"<project-id>","token":"<public-token>"}]
# ...or the individual values below:
NEXT_PUBLIC_PLASMIC_PROJECT_ID=<project-id>
NEXT_PUBLIC_PLASMIC_PROJECT_PUBLIC_TOKEN=<public-token>

# Optional explicit host URL (defaults to `${origin}/plasmic-host`).
NEXT_PUBLIC_PLASMIC_HOST_URL=http://localhost:3002/plasmic-host
```

## Scripts

- `npm run dev` – Starts Vite in dev mode (used internally by the Express backend).
- `npm run build` – Produces a production build in `dist/` consumed by the backend.
- `npm run preview` – Serves the production build locally for debugging.

The root backend process automatically mounts this Vite app in development and
serves the static build in production. Running `npm run build` inside
`plasmic-host/` ensures the backend can serve the latest assets when not in dev mode.
