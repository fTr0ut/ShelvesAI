# Task 003: metascore JSONB Column Migration + Upsert Update

## Context

We need to persist the metadata score result on each collectable so we can later query for low-quality entries, prioritize backfill jobs, and surface quality metrics in the admin dashboard.

The `MetadataScorer.score()` returns `{ score, maxScore, missing, scoredAt }`. This gets stored as JSONB in a new `metascore` column on the `collectables` table.

## Objective

1. Add a `metascore` JSONB column to the `collectables` table via a Knex migration.
2. Update `collectablesQueries.upsert()` to accept and write the `metascore` field.

## Scope

### 1. Migration file

**Filename:** `api/database/migrations/20260319000000_add_collectables_metascore.js`

(Convention: `YYYYMMDD` + `000000` + descriptive name. Today is 2026-03-19.)

```js
exports.up = function (knex) {
  return knex.schema.alterTable('collectables', (table) => {
    table.jsonb('metascore').nullable().defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('collectables', (table) => {
    table.dropColumn('metascore');
  });
};
```

Simple nullable JSONB column. No index needed yet (can add a GIN index later if query patterns demand it).

### 2. Update `api/database/queries/collectables.js`

In the `upsert()` function:

- **Destructure** `metascore` from `data` (add it to the destructuring block around line 191-217). Default to `null`.
- **Add to INSERT columns:** Add `metascore` to the column list in the INSERT statement.
- **Add to INSERT values:** Add `$25` (or whatever the next parameter number is) for `metascore`.
- **Add to ON CONFLICT UPDATE:** `metascore = COALESCE(EXCLUDED.metascore, collectables.metascore)` — always prefer the new score if provided, keep the old one if the new upsert doesn't include a score.
- **Add to the values array:** `metascore ? JSON.stringify(metascore) : null`

The key insight: `metascore` is always overwritten (not merged) because it's a point-in-time snapshot. `COALESCE` ensures we don't null-out an existing score if a caller doesn't provide one.

## Non-goals

- No index on the metascore column (premature optimization).
- No changes to the vision pipeline or CatalogRouter to actually compute and pass the metascore — that wiring happens naturally because `_metadataScore` and `_metadataMissing` are already attached to results by CatalogRouter, and the pipeline's `saveToShelf()` passes the full payload to `upsert()`. We just need to map those fields to the `metascore` key in the payload construction. **Actually** — this mapping needs to happen somewhere. Check `visionPipeline.js saveToShelf()` around line 1205-1235 where `collectablePayload` is built. Add `metascore` there too, constructed from the item's `_metadataScore`, `_metadataMissing`, and `_metadataMaxScore` if present. If not present, pass `null`.

## Constraints

- The migration must be idempotent-safe (Knex handles this via the migration lock).
- The upsert SQL parameter numbering must be updated carefully — currently there are 24 parameters ($1-$24). Adding metascore makes it $25.
- CommonJS module for the migration file.
