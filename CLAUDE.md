# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShelvesAI is a mobile-first social app for cataloging and sharing physical collections (books, movies, games, vinyl, etc.). Users photograph shelves, the app detects items via computer vision, matches them to catalog APIs, and enables social sharing.

## Development Commands

### Database
```bash
# Start PostgreSQL (required first)
docker-compose up -d db

# Run migrations
cd api && npx knex migrate:latest

# Optional: pgAdmin at http://localhost:5050 (admin@local.dev / admin)
```

### API Server
```bash
cd api && npm install && npm run dev    # Runs on port 5001
```

### Mobile App
```bash
cd mobile && npm install && npx expo start
```

### Testing
```bash
cd api && npm run test:backend          # Jest tests
cd api && npm run test:tmdb             # Test TMDB adapter
```

### Utility Scripts
```bash
cd api
npm run backfill:feed-aggregates        # Rebuild event aggregates
npm run backfill:feed-payloads          # Update feed payloads
npm run cache-covers                    # Cache cover images locally
```

## Architecture

```
Mobile (Expo/RN) ──► API (Express) ──► PostgreSQL
       │                  │
       │                  ├── Google Cloud Vision (OCR)
       │                  ├── Gemini AI (item detection)
       │                  └── Catalog APIs (TMDB, IGDB, OpenLibrary, Hardcover)
       │
       └── MLKit OCR (on-device)
```

### Key Directories
- `api/services/visionPipeline.js` - Core shelf scanning workflow
- `api/database/queries/` - Query builders organized by domain
- `api/database/migrations/` - Knex migrations (run in order)
- `mobile/src/screens/` - All 31 app screens
- `mobile/src/context/` - AuthContext, ThemeContext, ToastContext
- `AGENTS/` - Detailed workflow documentation and implementation storyboards

### Database Schema
PostgreSQL with key tables:
- `collectables` - Global item catalog with fingerprint deduplication
- `user_collections` - Links users to items on shelves
- `user_manuals` - Manual-only items (not in catalog)
- `user_ratings` - Decoupled rating system
- `event_logs` / `event_aggregates` - Social feed with time-windowed aggregation
- `shelves` - User shelves (books, movies, games, vinyl, other)

## Core Workflows

### Vision Pipeline
Photo → Cloud Vision OCR → Gemini detection → Fingerprint matching → Catalog lookup → Save

Confidence tiers determine workflow:
- High (≥0.92): Auto-save
- Medium (0.85-0.92): User confirmation
- Low (<0.85): Needs review queue

### "Other" Shelf
Special shelf type for miscellaneous items - uses `user_manuals` table only, skips catalog matching entirely.

### Event Aggregation
Events are grouped within 15-minute windows to prevent feed flooding. Comments and likes attach to aggregates, not individual events.

## API Structure

Routes defined in `api/routes/` map to controllers:
- `/api/auth` - JWT authentication (no Auth0)
- `/api/shelves` - Shelf CRUD and items
- `/api/feed` - Social feed with scope filtering (global/friends/mine)
- `/api/collectables` - Item details and search
- `/api/ratings` - Decoupled from collections

## Environment Variables

Required in `api/.env`:
```
DATABASE_URL or (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
JWT_SECRET
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_GEN_AI_KEY
OPENAI_API_KEY
TMDB_API_KEY
IGDB_CLIENT_ID
IGDB_CLIENT_SECRET
```

## Documentation

See `AGENTS/` directory for detailed documentation:
- `workflow.md` - Vision and feed workflows
- `backend-database-structure.md` - Full schema reference
- `api_routes.md` - Endpoint to screen mappings
- `event-system.md` - Activity feed architecture
- `storyboards/` - Implementation phases and tasks
