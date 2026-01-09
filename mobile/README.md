Shelves.AI Mobile (iOS/Android)

This is a lightweight Expo (React Native) app that connects to your existing backend APIs for login/registration, shelves, items, and account settings.

Prereqs
- Node.js 18+
- Expo CLI (npx is fine)
- Backend running and reachable from device (port 5001 by default)

Quick Start
1) In one terminal, run backend on port 5001:
   cd ../backend
   npm install
   npm run dev

2) In another terminal, start the mobile app:
   cd mobile
   npm install
   npx expo start

3) Open the Expo Go app on iOS/Android and scan the QR, or run an emulator via the prompts (press a for Android, i for iOS).

API Base Configuration
- The app tries to guess the API base using Expo host (LAN IP) and port 5001.
- You can override it in mobile/app.json under expo.extra.API_BASE.
- You can also set env vars when running Expo:
  - `EXPO_PUBLIC_API_BASE` to force a base URL.
  - `EXPO_PUBLIC_USE_NGROK=true` with `EXPO_PUBLIC_NGROK_URL` to opt into ngrok.
- If testing on a physical device, use your machine's LAN IP, e.g. http://192.168.1.20:5001.

Screens Implemented
- Login/Register: local auth, persists JWT in secure storage.
- Shelves: list/create shelves, open a shelf.
- Shelf Detail: list items, add manual item, search catalog and add.
- Account: view/update profile fields and privacy.

Notes
- Auth0 SSO is not wired (mobile variant requires Auth Session setup). If desired, we can integrate Auth0 with expo-auth-session.
- If you get network errors on device, ensure your backend is reachable over the same network (try curl from device or replace API_BASE).

Build (optional)
- Use EAS to produce native binaries: https://docs.expo.dev/build/introduction/
- Example:
  npm install -g eas-cli
  eas build:configure
  eas build -p ios
  eas build -p android

