# News & Discover Feature

This document describes the News/Discover feature implementation for ShelvesAI, which provides users with personalized trending, upcoming, and recent content based on their collection interests.

## Overview

The feature consists of:
1. **Daily background job** that fetches content from catalog APIs (TMDB, IGDB, Blu-ray.com, NYT Books)
2. **Database cache** (`news_items` table) storing normalized content
3. **API endpoint** serving personalized content to users
4. **Personalization logic** based on user's shelf types, creators, and genres

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    DAILY JOB (cron: 0 4 * * *)                           │
│                  api/jobs/refreshNewsCache.js                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐                               │
│  │      TMDB       │  │      IGDB       │                               │
│  │  ─────────────  │  │  ─────────────  │                               │
│  │  • Trending     │  │  • Top Rated    │                               │
│  │  • Upcoming     │  │  • Most Followed│                               │
│  │  • Now Playing  │  │  • Recent       │                               │
│  │  • TV On Air    │  │  • Popular      │                               │
│  └────────┬────────┘  └────────┬────────┘                               │
│           │                    │                                         │
│           └──────────┬─────────┘                                         │
│                      ▼                                                   │
│           ┌─────────────────────┐                                        │
│           │    news_items       │                                        │
│           │   (PostgreSQL)      │                                        │
│           └─────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    API REQUEST (per user)                                │
│                 GET /api/discover?category=all                           │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Query user's shelf types + favorite creators from user_collections   │
│  2. Filter news_items by matching categories/creators                    │
│  3. Rank by relevance score (category match + creator match + genre)     │
│  4. Return paginated, personalized feed                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

### news_items Table

```sql
CREATE TABLE news_items (
  id SERIAL PRIMARY KEY,

  -- Category mapping to shelf types
  category TEXT NOT NULL,        -- 'movies', 'tv', 'games', 'books', 'vinyl'
  item_type TEXT NOT NULL,       -- 'trending', 'upcoming', 'now_playing', 'recent'

  -- Core content
  title TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  release_date DATE,

  -- For matching to user interests
  creators TEXT[] DEFAULT '{}',     -- directors, authors, developers
  franchises TEXT[] DEFAULT '{}',   -- Marvel, Star Wars, etc.
  genres TEXT[] DEFAULT '{}',

  -- External references
  external_id TEXT,              -- 'tmdb:123', 'igdb:456'
  source_api TEXT,               -- 'tmdb', 'igdb', 'hardcover'
  source_url TEXT,               -- link to more info

  -- Full payload for flexibility
  payload JSONB DEFAULT '{}',

  -- Cache management
  fetched_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_news_items_category ON news_items(category);
CREATE INDEX idx_news_items_item_type ON news_items(item_type);
CREATE INDEX idx_news_items_expires_at ON news_items(expires_at);
CREATE INDEX idx_news_items_release_date ON news_items(release_date);
CREATE INDEX idx_news_items_creators ON news_items USING gin(creators);
CREATE INDEX idx_news_items_genres ON news_items USING gin(genres);
CREATE UNIQUE INDEX idx_news_items_unique ON news_items(source_api, external_id, item_type);
```

## API Endpoints

### GET /api/discover

Returns personalized news/trending items based on user's collection.

**Authentication:** Optional (personalization requires auth)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `category` | string | `'all'` | Filter by category: `movies`, `tv`, `games`, `books`, `all` |
| `item_type` | string | `'all'` | Filter by type: `trending`, `upcoming`, `now_playing`, `recent`, `all` |
| `limit` | number | `50` | Number of items (max: 100) |
| `offset` | number | `0` | Pagination offset |

**Response:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "category": "movies",
        "itemType": "trending",
        "title": "Dune: Part Two",
        "description": "Paul Atreides unites with Chani...",
        "coverImageUrl": "https://image.tmdb.org/t/p/w500/abc.jpg",
        "releaseDate": "2024-03-01",
        "creators": ["Denis Villeneuve"],
        "genres": ["Science Fiction", "Adventure"],
        "externalId": "tmdb:693134",
        "sourceApi": "tmdb",
        "sourceUrl": "https://www.themoviedb.org/movie/693134",
        "payload": {
          "vote_average": 8.3,
          "popularity": 2847.5
        },
        "relevanceScore": 5
      }
    ],
    "grouped": {
      "movies": {
        "trending": [...],
        "upcoming": [...],
        "now_playing": [...]
      },
      "tv": {
        "trending": [...],
        "now_playing": [...]
      },
      "games": {
        "trending": [...],
        "recent": [...],
        "now_playing": [...]
      }
    },
    "userInterests": {
      "categoriesCount": 3,
      "creatorsCount": 12,
      "genresCount": 8
    },
    "pagination": {
      "limit": 50,
      "offset": 0,
      "count": 50,
      "hasMore": true
    }
  }
}
```

### GET /api/discover/stats

Returns statistics about the news cache.

**Authentication:** Optional

**Response:**

```json
{
  "success": true,
  "data": {
    "total": 160,
    "byCategory": [
      {
        "category": "games",
        "itemType": "now_playing",
        "count": 20,
        "oldestFetch": "2024-01-19T04:00:00Z",
        "newestFetch": "2024-01-19T04:00:00Z"
      },
      {
        "category": "movies",
        "itemType": "trending",
        "count": 20,
        "oldestFetch": "2024-01-19T04:00:00Z",
        "newestFetch": "2024-01-19T04:00:00Z"
      }
    ]
  }
}
```

## Background Job

### refreshNewsCache.js

Location: `api/jobs/refreshNewsCache.js`

**Execution:**
```bash
# Manual run
node jobs/refreshNewsCache.js

# Cron schedule (daily at 4am)
0 4 * * * cd /path/to/api && node jobs/refreshNewsCache.js >> logs/news-cache.log 2>&1
```

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `NEWS_CACHE_EXPIRY_HOURS` | `36` | Hours until items expire |
| `NEWS_CACHE_ITEMS_PER_TYPE` | `20` | Max items fetched per type |

**NYT Books order of operations:**
1. Check `collectables` by `external_id` (`nyt:*`) to avoid unnecessary API calls.
2. If missing, enrich via `BookCatalogService` (OpenLibrary -> Hardcover fallback / CatalogRouter).
3. Run `CollectableDiscoveryHook` to upsert collectable data.
4. Upsert `news_items` with `collectable_id` when available.

**Output Example:**
```
============================================================
[News Cache] Starting refresh at 2024-01-19T04:00:00.000Z
[News Cache] Config: expiryHours=36, itemsPerType=20
============================================================
[News Cache] Fetching TMDB movies...
[News Cache] TMDB movies: 60 items stored
[News Cache] Fetching TMDB TV shows...
[News Cache] TMDB TV: 40 items stored
[News Cache] Fetching IGDB games...
[News Cache] IGDB games: 60 items stored
[News Cache] Fetching NYT bestsellers...
[News Cache] NYT Books: 40 items stored (22 enriched)
[News Cache] Cleaned up 0 expired items

[News Cache] Current cache contents:
  games/now_playing: 20 items
  games/recent: 20 items
  games/trending: 20 items
  movies/now_playing: 20 items
  movies/trending: 20 items
  movies/upcoming: 20 items
  tv/now_playing: 20 items
  tv/trending: 20 items
============================================================
[News Cache] Complete. 160 items refreshed, 0 errors, 0 expired removed
[News Cache] Duration: 1.9s
============================================================
```

## Discovery Adapters

### TmdbDiscoveryAdapter

Location: `api/services/discovery/TmdbDiscoveryAdapter.js`

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `fetchTrendingMovies(limit)` | Movies | Trending movies for the week |
| `fetchUpcomingMovies(limit)` | Movies | Upcoming releases (US region) |
| `fetchNowPlayingMovies(limit)` | Movies | Currently in theaters |
| `fetchTrendingTV(limit)` | TV Shows | Trending TV for the week |
| `fetchOnTheAirTV(limit)` | TV Shows | Currently airing shows |
| `fetchAllMovies()` | Movies | All movie content combined |
| `fetchAllTV()` | TV Shows | All TV content combined |
| `fetchAll()` | All | Everything combined |

**TMDB Endpoints Used:**
- `GET /trending/movie/week`
- `GET /trending/tv/week`
- `GET /movie/upcoming`
- `GET /movie/now_playing`
- `GET /tv/on_the_air`

### IgdbDiscoveryAdapter

Location: `api/services/discovery/IgdbDiscoveryAdapter.js`

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `fetchTopRatedGames(limit)` | Games | Highest rated games (rating > 85) |
| `fetchMostFollowedGames(limit)` | Games | Most followed/anticipated games |
| `fetchRecentReleases(limit)` | Games | Recently released, sorted by date |
| `fetchPopularGames(limit)` | Games | Most reviewed games |
| `fetchAll()` | All | Everything combined |

**IGDB Queries:**
- Top rated: `where cover != null & total_rating > 85; sort total_rating desc`
- Most followed: `where cover != null & follows != null; sort follows desc`
- Recent: `where cover != null & first_release_date != null; sort first_release_date desc`
- Popular: `where cover != null & total_rating_count != null; sort total_rating_count desc`

## Personalization Algorithm

When a user requests `/api/discover`, the system:

1. **Extracts user interests** from their collection:
   ```sql
   SELECT DISTINCT
     s.type as category,           -- shelf types they use
     c.primary_creator,            -- creators they collect
     unnest(c.tags) as genre       -- genres in their collection
   FROM user_collections uc
   JOIN shelves s ON s.id = uc.shelf_id
   LEFT JOIN collectables c ON c.id = uc.collectable_id
   WHERE uc.user_id = $1
   ```

2. **Calculates relevance score** for each news item:
   ```sql
   CASE WHEN category = ANY(user_categories) THEN 2 ELSE 0 END +
   CASE WHEN creators && user_creators THEN 3 ELSE 0 END +
   CASE WHEN genres && user_genres THEN 1 ELSE 0 END
   AS relevance_score
   ```

3. **Orders results** by:
   - Relevance score (descending)
   - Item type priority (trending > upcoming > now_playing > recent)
   - Popularity from source API
   - Release date (descending)

## File Structure

```
api/
├── database/migrations/
│   └── 20260120000000_create_news_items.js
├── services/discovery/
│   ├── TmdbDiscoveryAdapter.js
│   ├── IgdbDiscoveryAdapter.js
│   └── index.js
├── controllers/
│   └── discoverController.js
├── routes/
│   └── discover.js
├── jobs/
│   └── refreshNewsCache.js
└── server.js (route registration)
```

## Content Categories

| Category | Source API | Item Types |
|----------|------------|------------|
| `movies` | TMDB | `trending`, `upcoming`, `now_playing` |
| `tv` | TMDB | `trending`, `now_playing` |
| `games` | IGDB | `trending`, `upcoming`, `recent`, `now_playing` |
| `books` | NYT Books (enriched via OpenLibrary/Hardcover) | `bestseller`, `new_release`, `trending` |
| `vinyl` | (future) | `trending`, `recent` |

## Future Enhancements

### Gemini Editorial Layer (Optional)

For personalized editorial summaries, a secondary job could:

1. Run weekly (not daily) for active users
2. Query user's top-rated items and favorite creators
3. Generate personalized digest via Gemini:
   ```
   "Based on your love of Christopher Nolan films, here's why
   his upcoming project matters to you..."
   ```
4. Store in `user_editorial_cache` table with 7-day TTL

### Additional Sources

- **Hardcover** - Direct book discovery beyond NYT (optional)
- **Discogs** - Vinyl new releases
- **RSS Feeds** - Entertainment news aggregation

## Troubleshooting

### No IGDB Results

If IGDB returns 0 items, check:
1. `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` are set
2. Twitch OAuth credentials are valid
3. Query filters aren't too restrictive

### Stale Content

If content seems outdated:
1. Check `expires_at` timestamps in `news_items`
2. Verify cron job is running: `crontab -l`
3. Check job logs: `tail -f logs/news-cache.log`
4. Run manual refresh: `node jobs/refreshNewsCache.js`

### API Rate Limits

- **TMDB**: 40 requests/second (well within limits)
- **IGDB**: 4 requests/second (configured in adapter)
- **NYT Books**: 5 requests/minute, 500/day (adapter enforces ~12s delay)

Total calls vary by enabled adapters and item counts; check job logs for exact usage.
