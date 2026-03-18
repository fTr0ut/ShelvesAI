# Blu-ray Discovery Integration

Last updated: 2026-02-08 18:13:21 UTC

## Purpose

This integration ingests Blu-ray and 4K release signals from blu-ray.com and enriches them with TMDB metadata for discover/feed usage.

## High-Level Flow

1. `BlurayDiscoveryAdapter` scrapes source pages and extracts title/date/url/format.
2. News refresh jobs enrich matches with TMDB metadata when possible.
3. Enriched rows are written to `news_items`.
4. Collectable discovery hook may upsert into `collectables` for reuse.

## Supported Item Types

- `preorder_4k`
- `preorder_bluray`
- `new_release_4k`
- `new_release_bluray`
- `upcoming_4k`
- `upcoming_bluray`

## Key Files

- `api/services/discovery/BlurayDiscoveryAdapter.js`
- `api/services/discovery/CollectableDiscoveryHook.js`
- `api/jobs/refreshNewsCache.js`
- `api/database/migrations/20260120100000_add_physical_release_date.js`

## Stored Field Notes

- `physical_release_date`: release date from blu-ray.com source data.
- `release_date`: date from enrichment provider (TMDB).
- `source_api`: enrichment provider used.
- `source_url`: canonical provider/source URL.

## Operational Notes

- Matching is title-first and can have false positives for ambiguous titles.
- Keep refresh jobs idempotent; dedupe by source keys and normalized titles.
- Validate scraping selectors when blu-ray.com markup changes.
