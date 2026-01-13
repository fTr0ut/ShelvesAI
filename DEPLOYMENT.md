# ShelvesAI Deployment Guide

## Prerequisites
- Docker and Docker Compose
- Node.js 18+
- Google Cloud account (for Vision API)
- Domain with SSL (for production)

## Local Development

### 1. Start Database
```bash
docker-compose up -d db
```

### 2. Configure Environment
```bash
cp api/.env.example api/.env
# Edit api/.env with your values
```

### 3. Start API
```bash
cd api
npm install
npm run dev
```

### 4. Start Mobile
```bash
cd mobile
npm install
npx expo start
```

## Production Deployment

### Self-Hosted
1. **Database**: Set up PostgreSQL (Docker or managed service like Amazon RDS / Google Cloud SQL).
2. **Environment**: Configure environment variables on your server.
3. **API**: 
   - Build/Run with PM2 or Docker.
   - Ensure `JWT_SECRET` is strong and unique.
4. **Reverse Proxy**: Set up Nginx or Caddy to handle SSL and forward requests to the API port.

### Platform (Railway/Render)
1. **Repository**: Connect your GitHub repository.
2. **Root Directory**: Set root directory to `api`.
3. **Build Command**: `npm install`.
4. **Start Command**: `node index.js`.
5. **Environment**: Add all variables from `.env.example`.
6. **Database**: Provision a PostgreSQL database and set `DATABASE_URL`.

## Mobile Distribution
1. **Configure**: Update `mobile/app.json` with your actual bundle ID and version.
2. **Build**:
   - iOS: `eas build -p ios`
   - Android: `eas build -p android`
3. **Submit**: Use `eas submit` to send to App Store / Play Store.

## Feed Aggregation Rollout
1. **Run migrations**: `cd api && npx knex migrate:latest`
2. **Backfill aggregates**: `npm run backfill:feed-aggregates`
3. **Verify**: open the feed and confirm recent activity shows grouped events.
