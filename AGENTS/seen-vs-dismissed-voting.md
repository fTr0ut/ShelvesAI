# Seen vs Dismissed Voting System - Process Notes

## Why the split
- "Seen" means a user was exposed to a news item (rotation/recency signal).
- "Dismissed" means a user explicitly rejected the item (negative preference signal).
- Combining these signals made Discover hide items just because they appeared in the All feed, which is not desired behavior.

## High-level changes
- Keep `user_news_seen` for exposure tracking only.
- Add a new `user_news_dismissed` table for explicit rejects.
- Use dismissed filtering for Discover results.
- Use dismissed filtering for personalized recommendation candidates (feed injection).
- Apply a negative vote on dismiss in `news_items.votes`.

## Schema changes
- Added `news_items.votes` (int, default 0).
- Added `user_news_dismissed` table with `(user_id, news_item_id)` unique constraint and index.

## Backend behavior updates
- Discover API now excludes `user_news_dismissed` items for authenticated users.
- Dismiss endpoint now inserts into `user_news_dismissed` (not `user_news_seen`) and decrements `news_items.votes`.
- Recommendation query still uses `user_news_seen` to avoid immediate repeats, and now also excludes `user_news_dismissed`.
- Relevance score includes `COALESCE(votes, 0)` to reflect negative feedback.

## Mobile behavior (unchanged in this step)
- The existing dismiss button continues to call `/api/discover/dismiss`.
- No UI changes were required for the seen/dismissed split.

## Migration/compat notes
- Existing `user_news_seen` rows remain as "seen" history.
- There is no automatic backfill to `user_news_dismissed` because historical "seen" != "dismissed".
- If a backfill is desired, it would be a deliberate choice to treat all past seen items as dismissed.
