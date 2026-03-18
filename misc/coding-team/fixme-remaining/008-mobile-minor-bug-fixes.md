# 008 — Mobile Minor Bug Fixes (BUG-18, BUG-21)

## Context

Two small, independent mobile bugs:

1. **BUG-18**: In `mobile/src/screens/SocialFeedScreen.js` (~line 255), `entry.items` is assumed to be an array in the feed dismiss handler. Could crash if `entry.items` is undefined or null.

2. **BUG-21**: In `mobile/src/screens/CheckInScreen.js` (~lines 141-146), navigation calls both `goBack()` and `navigate()`, causing unexpected navigation stack state.

## Objective

Fix both bugs.

## Scope

- `mobile/src/screens/SocialFeedScreen.js` — add null check on `entry.items`
- `mobile/src/screens/CheckInScreen.js` — use only one navigation action

## Non-goals

- Do not refactor surrounding code.

## Constraints

- For BUG-18: use `(entry.items || []).filter(...)` or equivalent guard.
- For BUG-21: determine which navigation action is correct for the flow (likely `goBack()` to return to the previous screen after check-in submission) and remove the other. Check the navigation flow in `AGENTS/screen_flow.md` if unclear.
