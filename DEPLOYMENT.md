# Deployment Notes

Last updated: 2026-02-08 18:13:21 UTC

This file now serves as a short pointer. Use `DEPLOY.md` as the canonical deployment runbook.

## Local Bring-Up

```bash
# optional local postgres via docker compose
docker-compose up -d db

cd api
npm install
npm run dev

cd ../mobile
npm install
npx expo start
```

## Canonical Production Guide

See `DEPLOY.md` for:

- environment variable groups
- migration and backfill order
- API and mobile deployment expectations
