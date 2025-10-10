Shelves.AI — Deploy Guide (Render + Vercel)

This guide deploys the backend (Node/Express + MongoDB) on Render and the frontend (Vite + React) on Vercel. You can swap providers from the suggestions below.

Prerequisites
- GitHub repo for your project
- MongoDB Atlas cluster (free M0 works)

Security note
- Do not commit secrets. Ensure `backend/.env` is never in Git. Add it to .gitignore (already recommended below) and set env vars in your host dashboard.

1) Backend on Render

Option A — Web Service (recommended)
- Create a new Web Service from your GitHub repo.
- Root directory: `backend`
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment
  - `MONGO_URI` = your MongoDB Atlas connection string
  - `JWT_SECRET` = a long random string
  - `TMDB_API_KEY` = API key for The Movie Database cataloging
  - Optional `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` if you use Auth0
  - Optional `FRONTEND_DIST` if serving a built frontend (see Option B)
- Instance type: free tier

Notes
- The service URL will look like `https://your-backend.onrender.com`. Save this URL.
- CORS: the server already allows CORS for all origins.

Option B — Serve frontend from backend (single host)
- Keep the Web Service config above.
- Build your frontend locally or in CI, upload the `frontend/dist` to a storage, then point Render to it with env var `FRONTEND_DIST` or place the files under `backend/../frontend/dist` in the deployed image.
- On boot, `server.js` will serve `FRONTEND_DIST` if present.

2) Frontend on Vercel
- Import your GitHub repo into Vercel.
- Root directory: `frontend`
- Build Command: `npm run build`
- Output: `dist`
- Environment Variables (Production)
  - `VITE_API_BASE` = Render backend URL (e.g., `https://your-backend.onrender.com`)
  - Optional: your Auth0 values (`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`)
- Redeploy.

3) Validate
- Open your Vercel site. Use Login/Register; the app calls the backend using `VITE_API_BASE`.
- Create a shelf and add a manual item.

Alternatives
- Backend: Railway, Fly.io, Koyeb
- Frontend: Netlify, Cloudflare Pages
- Database: MongoDB Atlas M0

Troubleshooting
- 404/HTML returned to JSON fetch: Ensure `VITE_API_BASE` is set to your backend origin in Vercel. In dev, Vite proxies `/api` to `http://localhost:5001`.
- CORS errors: Render service should allow all origins via `cors()`; if you locked it down, add your Vercel domain.
- Auth0 on mobile: not included by default; integrate with `expo-auth-session` if desired.

