# API Compliance Status

Last updated: 2026-02-08 18:13:21 UTC

This document tracks API/provider compliance behavior implemented in code and open gaps.

## Coverage Summary

| Area | Current state | Notes |
| --- | --- | --- |
| Attribution model | Implemented | Provider attribution stored on collectables (`attribution` JSON). |
| Cover-source model | Implemented | `cover_image_source` distinguishes handling (`external` vs locally cached). |
| OpenLibrary covers | External hot-link | Adapter emits `coverImageSource: 'external'` and attribution link. |
| TMDB covers | External hot-link | Adapter emits `coverImageSource: 'external'` plus TMDB disclaimer/logo metadata. |
| Hardcover covers | Local cache eligible | Adapter emits `coverImageSource: null`; media pipeline can cache locally/S3. |
| S3 media support | Implemented | Optional via AWS env vars and shared media URL resolver. |

## Key Implementation Files

- `api/database/queries/media.js`
- `api/services/openLibrary.js`
- `api/adapters/tmdb.adapter.js`
- `api/adapters/hardcover.adapter.js`
- `api/services/mediaUrl.js`
- `mobile/src/screens/CollectableDetailScreen.js`

## Current Compliance and Security Gaps

1. Remote media ingestion hardening is incomplete.
   - Download path currently trusts upstream content type enough to write files.
   - Add MIME + magic-byte validation before persist.
2. Cache poisoning evidence exists from prior non-image payload ingestion.
   - Existing cache artifacts should be cleaned and invalidated.
3. Catalog write endpoints are too broad for global metadata mutation.
   - Restrict write routes to admin/mod roles.

Detailed remediation tasks are tracked in `FIXME.md`.

## Operational Checklist

- Verify provider attribution payloads are returned by collectable endpoints.
- Verify UI renders provider disclaimers/logos where required.
- Verify media URLs resolve correctly in both local and S3 modes.
- Reject non-image upstream payloads before cache write.
- Re-run compliance checks when adding new catalog providers.
