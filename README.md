# Collector Monorepo

This repository contains the Collector Express API, the Vite-powered web client,
and an Expo mobile shell. The sections below outline local development commands.

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

## Combined workflow

From the repository root you can run the backend and web client together:

```bash
# Install dependencies once
npm install

# In separate terminals
npm run server                # backend on http://localhost:5001
cd frontend && npm run dev    # Vite frontend on http://localhost:5173
```
