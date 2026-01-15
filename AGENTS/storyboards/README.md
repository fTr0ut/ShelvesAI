# ShelvesAI v2 Implementation Storyboards

## Overview

This directory contains phase-by-phase implementation storyboards for simplifying and launching ShelvesAI v2 with a mobile-first architecture.

## Phases

| Phase | Name | Duration | Description |
|-------|------|----------|-------------|
| 0 | [Cleanup](phase-0-cleanup.md) | 4-6 hrs | Clone repo, archive old, delete unnecessary code |
| 1 | [PostgreSQL](phase-1-postgresql.md) | 6-8 hrs | Set up PostgreSQL with Docker, create schema |
| 2 | [Backend Migration](phase-2-backend-migration.md) | 8-12 hrs | Migrate routes from MongoDB to PostgreSQL |
| 3 | [Vision API](phase-3-vision-api.md) | 4-6 hrs | Replace OpenAI Vision with Google Cloud Vision |
| 4 | [Mobile OCR](phase-4-mobile-ocr.md) | 4-6 hrs | Add ML Kit on-device OCR via expo-ocr |
| 5 | [Auth & Finalize](phase-5-auth-finalize.md) | 3-4 hrs | Remove Auth0, final cleanup |
| 6 | [API Compliance](phase-6-api-compliance.md) | 2-3 hrs | Attribution, licensing for commercial use |
| 7 | [UI Redesign](phase-7-ui-redesign.md) | 12-20 hrs | Modern mobile UI with premium aesthetics |

## Total Estimated Time

**~45-65 hours** of focused development work (6-8 days)

## Task Priority Legend

- 🔴 **Critical** - Blocks other work, must complete
- 🟡 **Medium** - Important for functionality
- 🟢 **Low** - Polish, documentation, can defer

## How to Use These Storyboards

1. **Start with Phase 0** - Clean slate before any feature work
2. **Complete phases in order** - Each phase has prerequisites
3. **Check off tasks** as you complete them
4. **Review completion checklist** before moving to next phase
5. **Test after each phase** - Don't accumulate technical debt

## Quick Start

```bash
# Phase 0: Clone and cleanup
git clone <repo> ShelvesAI-v2
cd ShelvesAI-v2
# Follow phase-0-cleanup.md tasks

# Phase 1: Start PostgreSQL
docker-compose up -d db
# Follow phase-1-postgresql.md tasks

# Continue through phases...
```

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                      Mobile App                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  ML Kit OCR │    │   Camera    │    │    Expo     │  │
│  │  (on-device)│    │   Capture   │    │  React Nav  │  │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘  │
│         │                  │                             │
│         └────────┬─────────┘                            │
│                  ▼                                       │
│         ┌───────────────┐                               │
│         │  REST Client  │                               │
│         └───────┬───────┘                               │
└─────────────────┼───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                    API Server                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Express   │    │  JWT Auth   │    │  Google CV  │  │
│  │   Routes    │    │  Middleware │    │   Service   │  │
│  └──────┬──────┘    └─────────────┘    └─────────────┘  │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Catalog Services                    │    │
│  │  OpenLibrary │ TMDB │ IGDB │ OpenAI Enrichment  │    │
│  └──────────────────────┬──────────────────────────┘    │
│                         │                               │
│                         ▼                               │
│                  ┌─────────────┐                        │
│                  │ PostgreSQL  │                        │
│                  └─────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | PostgreSQL | Social features need concurrent access |
| OCR (On-device) | ML Kit via expo-ocr | Free, fast, offline-capable |
| OCR (Cloud) | Google Cloud Vision | 95% accuracy, better than OpenAI Vision |
| AI Enrichment | OpenAI | Web search for catalog fallback |
| Auth | Local JWT | No third-party dependency |
| Frontend | Mobile only | Simplify for launch |
