# ShelvesAI — Deploy Guide (Render + Vercel)

This guide deploys the API (Node/Express + MongoDB) on Render and the mobile app via Expo. You can swap providers from the suggestions below.

## Prerequisites
- GitHub repo for your project
- MongoDB Atlas cluster (free M0 works)

## Security note
- Do not commit secrets. Ensure `api/.env` is never in Git. Add it to .gitignore and set env vars in your host dashboard.

## 1) API on Render

### Option A — Web Service (recommended)
- Create a new Web Service from your GitHub repo.
- Root directory: `api`
- Build Command: `npm install`
- Start Command: `node index.js`
- Environment
  - `MONGO_URI` = your MongoDB Atlas connection string
  - `JWT_SECRET` = a long random string
  - `TMDB_API_KEY` = API key for The Movie Database cataloging
  - Optional `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` if you use Auth0

### Notes
- The service URL will look like `https://your-api.onrender.com`. Save this URL.
- CORS: the server already allows CORS for all origins.

## 2) Mobile App (Expo)
- Configure `API_BASE` in the mobile app to point to your deployed API URL.
- Build using `eas build` for production releases.

## 3) Validate
- Open your mobile app and test login/register.
- Create a shelf and add an item.

## Alternatives
- API: Railway, Fly.io, Koyeb
- Database: MongoDB Atlas M0, PostgreSQL (Phase 1+)

## Troubleshooting
- 404/HTML returned to JSON fetch: Ensure `API_BASE` is set to your API origin.
- CORS errors: Render service should allow all origins via `cors()`; if you locked it down, add your mobile app domain.
