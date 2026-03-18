# ShelvesAI Mobile

Last updated: 2026-02-08 18:13:21 UTC

Expo React Native client for ShelvesAI.

## Prerequisites

- Node.js 18+
- API running from `../api` on port `5001` (or reachable API URL)
- Expo tooling (`npx expo start`)

## Quick Start

```bash
# Terminal 1
cd ../api
npm install
npm run dev

# Terminal 2
cd mobile
npm install
npx expo start
```

## API Base Resolution

Order used by the app:

1. `EXPO_PUBLIC_USE_NGROK=true` + `EXPO_PUBLIC_NGROK_URL`
2. `EXPO_PUBLIC_API_BASE`
3. Expo config `extra` values
4. Host-derived fallback (`http://<host>:5001`)

## Notable Behaviors

- Auth token and premium flag are persisted in AsyncStorage.
- Onboarding gate is driven by `GET /api/account`.
- Premium toggle in account controls cloud vision mode.
- If cloud vision quota is exceeded, app falls back to on-device OCR + catalog lookup.

## Build

```bash
cd mobile
npx expo start
# optional native builds with EAS
```
