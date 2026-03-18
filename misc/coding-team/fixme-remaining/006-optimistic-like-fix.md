# 006 — SocialFeedScreen Optimistic Like Stale State Fix

## Context

BUG-11: In `mobile/src/screens/SocialFeedScreen.js` (~lines 416-440), `handleToggleLike` captures `previous` state from the `entry` parameter at invocation time. On error, it reverts to this captured state. If multiple rapid likes happen in sequence and one fails, the revert uses a stale snapshot instead of the actual current state.

`FeedDetailScreen.js` (~lines 99-116) has a better pattern that stores previous values separately.

## Objective

Fix the optimistic like revert to use accurate previous state, preventing stale state restoration on error.

## Scope

- `mobile/src/screens/SocialFeedScreen.js` — `handleToggleLike` function and `updateEntrySocial` helper

## Non-goals

- Do not add a queue for rapid interactions (overengineering for this use case).
- Do not change the like API contract.

## Constraints

- Reference the `FeedDetailScreen.js` pattern for the fix approach.
- The fix should capture the actual `hasLiked` and `likeCount` values from the current entries state at the moment of the optimistic update (using a functional state updater or reading from a ref), not from the closure-captured `entry` parameter.
- Ensure the revert on error restores the values that were in place immediately before the optimistic update, not values from an earlier render.
