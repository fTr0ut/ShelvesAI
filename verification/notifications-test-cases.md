# Notification System Test Cases

## Scope
- Friend request notification dedupe (same requester -> same addressee).
- Like/unlike soft-delete behavior.
- Comment and friend-accept notifications.
- Unread count and mark-as-read behavior.

## Preconditions
- Notifications migration applied.
- Notification routes/controllers enabled.
- Two test users available (User A, User B).
- At least one collectable exists (for check-in events).

## Automated API Script (writes data)
- Script: `verification/verify-notifications-api.js`
- Expected:
  - Duplicate friend request from User B to User A produces exactly one `friend_request` notification for User A.
  - Like creates a `like` notification for User A.
  - Unlike removes the `like` notification from User A's list (soft-delete).
  - Like again recreates or restores the `like` notification.
  - Comment creates a `comment` notification for User A.
  - Accepting the request creates a `friend_accept` notification for User B.
  - Mark-as-read flips `is_read` for the test notifications when supported by the API.

## Read-Only DB Checks
- Script: `verification/verify-notifications-db.js`
- Expected:
  - No duplicate active `friend_request` notifications per `(user_id, actor_id, entity_id)`.
  - At most one active `like` notification per `(user_id, actor_id, entity_id)`; soft-deleted rows are allowed.
  - Warn if no soft-delete column (`deleted_at`, `is_deleted`, or `is_active`) exists.
