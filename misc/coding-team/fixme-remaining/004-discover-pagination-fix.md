# 004 — Discover Pagination Fix for category=all & item_type=all

## Context

BUG-15: In `api/controllers/discoverController.js`, when both `category === 'all'` and `item_type === 'all'`, the query uses a CTE with `ROW_NUMBER()` partitioned by `(category, item_type)` with `WHERE rn <= $N`. The `offset` parameter is completely ignored in this code path — users always get the same first N items per group regardless of offset.

The non-all paths (specific category or item_type) correctly use `OFFSET`.

## Objective

Make pagination work correctly for the `category=all & item_type=all` query path.

## Scope

- `api/controllers/discoverController.js` — the CTE query branch (~line 96-155)

## Non-goals

- Do not change the personalization/scoring logic.
- Do not change the response shape.
- Do not change behavior for non-all query paths (they work correctly).

## Constraints

- The current windowed approach (`ROW_NUMBER() PARTITION BY (category, item_type)`) is intentional — it ensures balanced representation across groups. The fix should preserve this balanced grouping while supporting offset-based paging.
- One approach: apply offset to the outer query after the window filter. Another: use a global row number for deterministic cross-group paging. Choose whichever is simpler.
- Verify that the `pagination` object in the response (`hasMore`, `count`) is accurate after the fix.
