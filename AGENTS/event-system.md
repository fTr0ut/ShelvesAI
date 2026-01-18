# Event System Architecture

This document describes the ShelvesAI event system, which powers the social feed with activity logging, aggregation, and visibility controls.

---

## Overview

The event system captures user activities (adding items, rating, check-ins) and displays them in a social feed. Events are **aggregated** within configurable time windows to prevent feed flooding when users perform multiple actions in quick succession.

```
User Action → logEvent() → getOrCreateAggregate() → event_aggregates + event_logs
                                    ↓
                           Feed Queries → SocialFeedScreen
```

---

## Database Schema

### `event_aggregates`
The primary table for feed display. Each row represents an aggregated event.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | User who performed the action |
| `shelf_id` | INTEGER | Associated shelf (NULL for global events like ratings) |
| `event_type` | TEXT | Event type (e.g., `item.added`, `item.rated`, `checkin.activity`) |
| `window_start_utc` | TIMESTAMP | Start of aggregation window |
| `window_end_utc` | TIMESTAMP | End of aggregation window |
| `item_count` | INTEGER | Number of items in this aggregate |
| `preview_payloads` | JSONB | Array of up to 5 item payloads for preview |
| `created_at` | TIMESTAMP | When aggregate was created |
| `last_activity_at` | TIMESTAMP | Last activity in this aggregate |
| `visibility` | TEXT | For check-in events: public/friends/private |
| `collectable_id` | UUID | For check-in events: the collectable being checked into |

### `event_logs`
Individual event records linked to aggregates.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | User who performed the action |
| `shelf_id` | INTEGER | Associated shelf |
| `aggregate_id` | UUID | Link to event_aggregates |
| `event_type` | TEXT | Specific event type |
| `payload` | JSONB | Full event payload |
| `created_at` | TIMESTAMP | When event occurred |

---

## Event Types

| Event Type | Description | Aggregation |
|------------|-------------|-------------|
| `item.collectable_added` | Item added from catalog | Per shelf, merged with manual |
| `item.manual_added` | Manually entered item | Per shelf, merged with collectable |
| `item.added` | Aggregated item event | Display type when mixed |
| `item.rated` | Item rating set | Global (null shelfId) |
| `checkin.activity` | User check-in | Per collectable |
| `shelf.created` | New shelf created | Not aggregated |

---

## Aggregation Logic

### Configuration
```env
FEED_AGGREGATE_WINDOW_MINUTES=60  # Default: 15 minutes
FEED_AGGREGATE_PREVIEW_LIMIT=5    # Max items in preview_payloads
FEED_AGGREGATE_DEBUG=true         # Enable debug logging
```

### How Aggregation Works

1. **User performs action** → `logEvent()` called
2. **Find active aggregate** via `getOrCreateAggregate()`:
   - For shelf-based item events: Match by (userId, shelfId, `item.%`)
   - For global events (ratings): Match by (userId, NULL shelfId, eventType)
   - For other events: Match by (userId, shelfId, eventType)
3. **If active aggregate found** (window_end_utc >= NOW):
   - Increment `item_count`
   - Update `last_activity_at`
   - Append to `preview_payloads` (up to limit)
4. **If no active aggregate**: Create new aggregate with fresh window

### Aggregation Rules

| Event Category | Aggregation Key | Notes |
|---------------|-----------------|-------|
| Shelf item events | (userId, shelfId) | All `item.*` events merge together |
| Rating events | (userId, NULL) | Aggregate all ratings globally |
| Check-in events | (userId, shelfId, eventType) | Keep separate per collectable |

---

## Event Payloads

### Item Added/Rated Payload
```json
{
  "itemId": 123,
  "collectableId": "uuid",
  "title": "Book Title",
  "primaryCreator": "Author Name",
  "coverUrl": "https://...",
  "coverMediaPath": "collectables/abc.jpg",
  "rating": 4.5,
  "type": "book"
}
```

### Check-in Payload
```json
{
  "collectableId": "uuid",
  "status": "starting|continuing|completed",
  "note": "User's note"
}
```

---

## Feed Queries

### Scopes

| Scope | Function | Description |
|-------|----------|-------------|
| `global` | `getGlobalFeed()` | Friends + public, excluding self |
| `friends` | `getFriendsFeed()` | Friends only |
| `all` | `getAllFeed()` | Self + friends + public |
| `mine` | `getMyFeed()` | Own events only |

### Visibility Rules

| Event Type | Visibility Check |
|------------|------------------|
| Shelf-based | Shelf visibility (public/friends) |
| Check-in | Event visibility field |
| Rating (global) | Visible to friends |

---

## API Endpoints

### Feed
- `GET /api/feed?scope=global|friends|all|mine&type=event_type`
- `GET /api/feed/:aggregateId` - Get single event details

### Social
- `POST /api/events/:eventId/like` - Toggle like
- `POST /api/events/:eventId/comments` - Add comment
- `GET /api/events/:eventId/comments` - Get comments

---

## Display Hints

Feed entries include a `displayHints` object that tells the frontend how to render content. This makes the frontend data-driven - new event types can be added without requiring frontend updates.

### Display Hints Structure

```json
{
  "displayHints": {
    "showShelfCard": true,
    "sectionTitle": "Newly added collectibles",
    "itemDisplayMode": "numbered"
  }
}
```

### Display Hint Properties

| Property | Type | Description |
|----------|------|-------------|
| `showShelfCard` | boolean | Whether to display the shelf info card |
| `sectionTitle` | string\|null | Title for the items section (null = no title) |
| `itemDisplayMode` | string | How to render items: `numbered`, `rated`, `checkin` |

### Event Type Hints

| Event Type | showShelfCard | sectionTitle | itemDisplayMode |
|------------|---------------|--------------|-----------------|
| `item.collectable_added` | true | "Newly added collectibles" | `numbered` |
| `item.manual_added` | true | "Newly added collectibles" | `numbered` |
| `item.rated` | false | "New ratings" | `rated` |
| `checkin.activity` | false | null | `checkin` |
| `shelf.created` | true | "New shelf" | `numbered` |

### Item Display Modes

| Mode | Description |
|------|-------------|
| `numbered` | Shows: index number, cover image, title |
| `rated` | Shows: cover image, title, star rating |
| `checkin` | Special check-in card rendering |

### Frontend Fallback

The frontend includes fallback logic when `displayHints` is not present:
```javascript
const hints = displayHints || {
  showShelfCard: eventType !== 'item.rated',
  sectionTitle: eventType === 'item.rated' ? 'New ratings' : 'Newly added collectibles',
  itemDisplayMode: eventType === 'item.rated' ? 'rated' : 'numbered',
};
```

### Implementation Location
- Backend: `api/controllers/feedController.js` - `getDisplayHints()` function
- Frontend: `mobile/src/screens/FeedDetailScreen.js` - `hints` object and render logic

---

## Frontend Display

### SocialFeedScreen
Renders different card types based on `eventType`:
- **Check-in**: Status icon, collectable preview, note
- **Rating**: Star icons, cover thumbnails with ratings
- **Item added**: Summary text, cover thumbnails

### FeedDetailScreen
Shows full event details including all items, comments, and likes.

Uses `displayHints` to control rendering:
- **Shelf Card**: Conditionally shown based on `hints.showShelfCard`
- **Section Title**: Dynamic title from `hints.sectionTitle`
- **Item Rendering**: Switches between `renderItem` (numbered) and `renderRatingItem` (rated) based on `hints.itemDisplayMode`

#### Rating Item Display
For `item.rated` events, items are rendered with:
- Cover image (32x48)
- Title text
- 5-star rating display (full, half, and empty stars)

---

## Code Locations

| Component | Path |
|-----------|------|
| Event logging | `api/database/queries/feed.js` |
| Feed controller | `api/controllers/feedController.js` |
| Social actions | `api/controllers/eventSocialController.js` |
| Mobile feed screen | `mobile/src/screens/SocialFeedScreen.js` |
| Mobile detail screen | `mobile/src/screens/FeedDetailScreen.js` |
