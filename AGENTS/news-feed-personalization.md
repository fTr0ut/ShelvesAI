# News Feed Personalization + All-Tab Blend (Implementation Notes)

This document summarizes the work done to personalize the news feed, blend it into the All tab as events, and make news items linkable to Collectable detail views.

## Scope

- Generate user-personalized news recommendations from `news_items`.
- Inject those recommendations into the `/api/feed?scope=all` response as event cards.
- Keep payloads filterable at the page level (opt-out-friendly).
- Render news recommendation cards in the mobile feed.
- Link news items to Collectable detail by resolving `collectables.id` from `external_id`.

## Key Files Added/Updated

- `api/services/discovery/newsRecommendations.js`
- `api/controllers/feedController.js`
- `mobile/src/screens/SocialFeedScreen.js`

## Endpoints

- `GET /api/feed?scope=all`
  - Now returns standard feed entries **plus** `news.recommendation` events interleaved.
  - Respect `limit` and `offset`. News injection only happens when `offset === 0`.
  - If `type` is provided and not `news.recommendation`, news injection is skipped.

- `GET /api/discover`
  - Unchanged; still returns the Discover tab content.

## Recommendation Logic (Backend)

Implemented in `api/services/discovery/newsRecommendations.js`.

### User Interest Profile

Builds interest signals from:

- Shelf category (`shelves.type`)
- Creators (`collectables.primary_creator`, `collectables.creators`)
- Genres/Tags (`collectables.genre`, `collectables.tags`)
- Formats from:
  - `collectables.formats`
  - `user_collections.format`
  - `user_manuals.format`

### 4K Gating

Only recommend `*_4k` items when the user shows 4K interest:

- Minimum movie count: `NEWS_FEED_MIN_MOVIES_FOR_FORMAT` (default 10)
- Minimum 4K count: `NEWS_FEED_MIN_4K_COUNT` (default 3)
- Minimum 4K ratio: `NEWS_FEED_MIN_4K_RATIO` (default 0.15)

### Candidate Selection

Filters:

- `news_items.expires_at > NOW()`
- Category matches user categories (when present)
- Excludes items already in the user's collection by `external_id`

Scoring:

- Category match: +2
- Creator overlap: +3
- Genre overlap: +1

Ranking:

- Score descending
- Release date (physical preferred) descending
- Popularity from payload (if present)

Grouping:

- Partition by `(category, item_type)`
- Keep top `NEWS_FEED_ITEMS_PER_GROUP` per group
- Take top `NEWS_FEED_GROUP_LIMIT` groups overall

### Collectable Linking

`news_items.external_id` is joined to `collectables.external_id` to resolve:

- `collectableId`
- `collectableKind`
- `collectablePrimaryCreator`

These are embedded in the recommendation payload so mobile can link directly.

## Feed Injection Logic (Backend)

Implemented in `api/controllers/feedController.js`.

### New Event Type

`eventType = 'news.recommendation'`

Display hints:

- `showShelfCard: false`
- `sectionTitle`: computed from `category` + `item_type`
- `itemDisplayMode: 'news'`

### Filterable Payload Fields

Each news entry includes:

- `origin: 'news_items'`
- `filterKey: 'news_items'`
- `feedTags: ['news', 'discover', category, item_type, ...format tags]`

These fields allow page-level filtering without schema changes.

### Interleaving Strategy

News entries are inserted every `NEWS_FEED_INSERT_INTERVAL` items (default 3).

## Mobile UI Behavior

Implemented in `mobile/src/screens/SocialFeedScreen.js`.

### News Recommendation Card

- Renders a compact Discover-style card inside the All feed.
- Shows title + cover thumbnails (up to 3).
- Tap on the **card** switches to the Discover tab.
- Tap on a **cover** opens `CollectableDetail` if `collectableId` exists.
- No likes/comments are shown for these cards (they are not real `event_aggregates`).

## Environment Variables

- `NEWS_FEED_GROUP_LIMIT` (default 3)
- `NEWS_FEED_ITEMS_PER_GROUP` (default 3)
- `NEWS_FEED_INSERT_INTERVAL` (default 3)
- `NEWS_FEED_MIN_MOVIES_FOR_FORMAT` (default 10)
- `NEWS_FEED_MIN_4K_COUNT` (default 3)
- `NEWS_FEED_MIN_4K_RATIO` (default 0.15)

## Payload Shape (News Recommendation)

Example:

```json
{
  "eventType": "news.recommendation",
  "origin": "news_items",
  "filterKey": "news_items",
  "feedTags": ["news", "discover", "movies", "new_release_4k", "format:4k"],
  "displayHints": {
    "showShelfCard": false,
    "sectionTitle": "New 4K Releases",
    "itemDisplayMode": "news"
  },
  "items": [
    {
      "id": 123,
      "title": "Dune: Part Two",
      "collectableId": 456,
      "coverImageUrl": "https://...",
      "sourceUrl": "https://..."
    }
  ]
}
```

## Notes / Follow-ups

- Some news items may lack `external_id` or not yet exist in `collectables`; those cards still open Discover.
- If you want guaranteed linking, add `collectable_id` to `news_items` during upsert.
- Consider adding per-user "seen" tracking to reduce repeat recommendations.
