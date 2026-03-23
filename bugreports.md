### FOR AGENTs
-You must update this file with your changes / task completions. 
-You must test all changes that you implement.
-You must update DependencyTree.md with your changes.

### Enhancements to prevent bugs
-~~Enhance the workflow in the enrichment phase to reply back to the existing Gemini request to keep the context level high and provide more accurate results. Right now, a new/separate request is sent to Gemini to cleanup up noisy ocr. It's given the results of the previous conversation, but context could help provide higher quality cleanup.~~ **DONE 3/23/26** — Enrichment now continues the original Gemini chat session via `startChat({ history })` + `sendMessage()`. The model retains the shelf photo and its own extraction when enriching. Applies to all shelf types including "other" (search grounding). Falls back to standalone mode when vision/text models differ or MLKit provides raw items.

-Now that each request has a jobid, develop a work queue so we don't overload APIs. If a queue becomes long, keep the job in queue but notify the user that "we're working on it! We'll ping you when your request is complete". Send a notification to the user was the jobid reaches a pass/fail state.



### Bugs/issues reported by users

-iPhone: could not enter city / state without closing and reopening the app. v1 build 2 3/22/2026
-~~iPhpne: took photo of shelf several times, AI/Vision workflow completed but 0 items were added. Note from CREATOR: Possible reason could be token limit was reached. We should ensure that we still capture the json and parse it, even if its partial. v1 build 2 3/22/26~~ **DONE 3/23/26** - `detectShelfItemsFromImage()` no longer swallows Gemini transport failures as empty results (now throws `VISION_PROVIDER_UNAVAILABLE`/`VISION_EXTRACTION_FAILED` so the job fails visibly), and now attempts truncated JSON recovery for partial vision responses so complete items are still parsed/saved when token output is cut off.
-~~iphone: uploaded same photo to same 'other' shelf multiple times. Slight difference in how model returned name and creator, thus dupe were created each time. v1 build 2 3/22/26~~ **DONE 3/23/26** - Added `other` shelf duplicate controls across pipeline + review completion: canonicalized matching keys, exact fingerprint/barcode checks, conservative fuzzy matching (`fuzzy_auto` vs `fuzzy_review`), and in-scan batch dedupe (`barcode` -> `manualFingerprint` -> canonical title+creator).
-created 'other' shelf but used it for uploading books. Description was optional, so no text was inputted. Model did not know how to respond. Make Description mandatory when shelf = 'other'. v1 build 2 3/22/26.
-~~'Other' shelf easily allows duplicates due to slight various in the way that models return ocr data. 3/22/26~~ **DONE 3/23/26** - Added DB-level guardrails (`idx_user_collections_unique_manual`, `idx_user_manuals_unique_fingerprint`) with cleanup migration to collapse legacy duplicates and repoint dependent `manual_id` references before applying unique indexes.
-~~Backend Postgress pooler leak "[req_8a3f97d7] 2026-03-22T23:19:44.421Z [user:f4af6e7d-9df1-4ab3-9921-7aec00b228f9] error  Query error:  {"text":"INSERT INTO job_events (job_id, level, message, user_id, metadata, created_at)\n     SELECT $1, $2, $","error":"MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size"}" | 3/22/26~~ **DONE 3/23/26** - Disabled request-level HTTP logger middleware (`api/middleware/requestLogger`) in `api/server.js`, which removes GET/POST request console logs and request-driven `job_runs` / `job_events` DB writes.

-ShelfDetailList needs caching. When the user goes from ShelfDetailScreen --> CollectableDetailScreen --> shelfdetailScreen, the list flickers as if it's being destoryed and recreated. Interesting observation on iPhone (probably android as well), if the user explicitly uses the back button in the top lefthand corner then the list still cached/no flicker. If the user uses the built-in iOS swipe navigation to go to the previous screen, then it flickers/reloads. v1 build 2 3/23/206

### Cleanup
-~~every post/get is assigned a jobid. That doesn't seem necessary. We should only assign jobids to workflow request items.~~ **DONE 3/23/26** - Request middleware unmounted; workflow/scheduled job logging via `jobRunner` remains available.
-~~Re-add request-level auto job IDs for workflow endpoints only (vision/catalog/etc) after global request logger removal.~~ **DONE 3/23/26** - Added lightweight workflow context middleware (`api/middleware/workflowJobContext.js`) and mounted it on `POST /api/shelves/:shelfId/vision` and `POST /api/shelves/:shelfId/catalog-lookup` to auto-assign request job IDs without re-enabling global GET/POST request DB logging.
-Added market value enhancement end-to-end (3/23/26): introduced `market_value` on `collectables` + `user_manuals`, added `market_value_sources` JSONB storage for Gemini links, wired persistence through vision/manual/catalog flows, and updated Gemini prompts/schema to request both value and sources. API payloads currently omit `marketValueSources` intentionally.
-Added vision match observability (3/23/26): when extracted items resolve to existing records, `VisionPipeline` now logs `sourceTable` + `sourceId` for `collectables` and `user_manuals` matches (including `user_collections` id when a manual match is already linked or newly linked to a shelf).
-Added same-photo vision idempotency for shelf scans (3/23/26): introduced persistent `vision_result_cache` keyed by `user_id+shelf_id+image_sha256` with 24h TTL. `POST /api/shelves/:shelfId/vision` now short-circuits on cache hit (sync + async) and logs cache hit/miss; successful uncached runs persist cache entries.
