# Task 002: MusicCatalogService + MusicBrainzAdapter + Adapter Transformer

## Context

ShelvesAI has catalog services for books, movies, games, and TV. Vinyl shelves have no catalog service yet. MusicBrainz is a free, public music metadata API. We need to follow the exact same patterns as `MovieCatalogService` / `TmdbAdapter` / `tmdb.adapter.js`.

The request queue from Task 001 (`MusicBrainzRequestQueue`) is already implemented and must be used for all HTTP calls to MusicBrainz.

## Objective

Create three files:
1. `api/services/catalog/MusicCatalogService.js` — the catalog service (like MovieCatalogService)
2. `api/services/catalog/adapters/MusicBrainzAdapter.js` — the CatalogRouter adapter (like TmdbAdapter)
3. `api/adapters/musicbrainz.adapter.js` — the response transformer (like tmdb.adapter.js)

## Scope

### 1. `api/services/catalog/MusicCatalogService.js`

Follow `MovieCatalogService` class structure exactly. Key methods:

- **`constructor(options)`** — Accept `fetch`, `delayFn`, `timeoutMs`, `concurrency`, `retries` like MovieCatalogService. Use `MusicBrainzRequestQueue` (via `getRequestQueue()`) instead of `RateLimiter` for rate limiting. Set `serviceName = 'musicbrainz'`. No API key needed (MusicBrainz is public).

- **`supportsShelfType(type)`** — Delegate to `shelfTypeResolver.supportsShelfType(type, 'vinyl')`.

- **`shouldRunSecondPass(type, unresolvedCount)`** — Same pattern as MovieCatalogService.

- **`lookupFirstPass(items, options)`** — Same concurrency-pool pattern as MovieCatalogService. Call `safeLookup` per item. Return `{ status: 'resolved'|'unresolved', input, enrichment }` array.

- **`safeLookup(item, retries)`** — Extract `title` (from `item.name || item.title`) and `artist` (from `item.author || item.primaryCreator`). Search MusicBrainz release-groups, pick best match, fetch details. Return `{ provider: 'musicbrainz', score, releaseGroup, search: { query, totalResults } }` or null. Retry on 429/503 with exponential backoff (same pattern as MovieCatalogService).

- **`safeLookupMany(item, limit, retries)`** — Return top N matches (same pattern as MovieCatalogService.safeLookupMany).

- **`enrichWithOpenAI()`** — No-op, return all unresolved (same as MovieCatalogService).

- **`buildCollectablePayload(entry, item, lwf)`** — Delegate to `musicbrainzReleaseGroupToCollectable()` from the adapter transformer. Same pattern as MovieCatalogService lines 336-398.

- **`searchReleaseGroups({ title, artist })`** — Call MusicBrainz search API:
  - URL: `https://musicbrainz.org/ws/2/release-group?query=<lucene_query>&fmt=json&limit=10`
  - Build Lucene query: if artist provided, `releasegroup:"<title>" AND artist:"<artist>"`, otherwise just `releasegroup:"<title>"`.
  - Use `fetchJson()` which goes through the request queue.

- **`fetchReleaseGroupDetails(mbid)`** — Lookup by MBID:
  - URL: `https://musicbrainz.org/ws/2/release-group/<mbid>?inc=artist-credits+releases+genres+tags+ratings&fmt=json`
  - Use `fetchJson()`.

- **`pickBestMatch(results, { title, artist })`** — Call `rankMatches`, return first.

- **`rankMatches(results, { title, artist })`** — Score candidates by:
  - Exact title match: +50
  - Partial title match: +25
  - Artist name match (compare against `artist-credit` names): +30 exact, +15 partial
  - Has `first-release-date`: +5
  - Score from API (`score` field in search results): add `result.score / 10`
  - Primary type is "Album": +10

- **`fetchJson(url)`** — Wrap fetch call in `this._requestQueue.enqueue(() => ...)`. Use AbortController with timeout. Set headers:
  - `User-Agent: ShelvesAI/1.0 (johnandrewnichols@gmail.com)`
  - `Accept: application/json`

### 2. `api/adapters/musicbrainz.adapter.js`

Follow `tmdb.adapter.js` pattern exactly. Single export: `musicbrainzReleaseGroupToCollectable(releaseGroup, options)`.

Transform MusicBrainz release-group JSON to collectable shape:

```
{
  kind: 'album',
  type: 'album',
  title: releaseGroup.title,
  description: releaseGroup.disambiguation || null,
  primaryCreator: first artist from artist-credit,
  creators: all artist names from artist-credit,
  year: extract year from first-release-date,
  publisher: label name from first release's label-info (if available),
  tags: from releaseGroup.tags (name array),
  genre: from releaseGroup.genres (name array),
  lightweightFingerprint,
  fingerprint,
  identifiers: {
    musicbrainz: {
      releaseGroup: [releaseGroup.id],
      ...(first release id if available)
    }
  },
  images: [{
    kind: 'cover',
    urlSmall: `https://coverartarchive.org/release-group/${releaseGroup.id}/front-250`,
    urlMedium: `https://coverartarchive.org/release-group/${releaseGroup.id}/front-500`,
    urlLarge: `https://coverartarchive.org/release-group/${releaseGroup.id}/front`,
    provider: 'coverartarchive',
  }],
  sources: [{
    provider: 'musicbrainz',
    ids: { releaseGroup: releaseGroup.id },
    urls: {
      releaseGroup: `https://musicbrainz.org/release-group/${releaseGroup.id}`,
      api: `https://musicbrainz.org/ws/2/release-group/${releaseGroup.id}`,
    },
    fetchedAt,
  }],
  extras: {
    primaryType: releaseGroup['primary-type'],
    secondaryTypes: releaseGroup['secondary-types'],
    firstReleaseDate: releaseGroup['first-release-date'],
    rating: releaseGroup.rating,
  },
  coverImageUrl: cover art archive URL (front-500) or null,
  coverImageSource: 'external',
  attribution: {
    linkUrl: `https://musicbrainz.org/release-group/${releaseGroup.id}`,
    linkText: 'View on MusicBrainz',
    logoKey: 'musicbrainz',
    disclaimerText: 'This product uses the MusicBrainz API and is subject to the Creative Commons CC BY-NC-SA 3.0 license.',
  },
}
```

Use `makeCollectableFingerprint` and `makeLightweightFingerprint` from `services/collectables/fingerprint.js` with `mediaType: 'album'`.

### 3. `api/services/catalog/adapters/MusicBrainzAdapter.js`

Follow `TmdbAdapter.js` pattern exactly:
- `name = 'musicbrainz'`
- `isConfigured()` — always returns `true` (MusicBrainz is public, no API key)
- `_getService()` — lazy-load `MusicCatalogService`
- `lookup(item, options)` — call `service.safeLookup()` wrapped in `withTimeout()`, convert via `_toCollectable()`
- `_toCollectable(result, originalItem)` — call `musicbrainzReleaseGroupToCollectable()` from the adapter transformer

## Non-goals

- No barcode/disc ID lookup
- No OpenAI enrichment
- No discovery adapter (news feed)
- No metadata scoring (book-specific feature)

## Constraints

- CommonJS modules
- All HTTP calls to musicbrainz.org MUST go through `MusicBrainzRequestQueue.enqueue()`
- User-Agent header: `ShelvesAI/1.0 (johnandrewnichols@gmail.com)`
- MusicBrainz returns `score` field (0-100) in search results — use it in ranking
- Cover Art Archive URLs may 404 (album has no art) — that's fine, we still set the URL and let the client handle it
