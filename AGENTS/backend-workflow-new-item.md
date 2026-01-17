# Backend Workflow: New Item Addition

This document outlines the backend workflow when a new item is attempted to be added to a shelf in the ShelvesAI application.

## Overview

The process of adding an item generally follows two main paths:
1.  **Adding a Collectable** (Catalog Item): The user selects an existing item from the global catalog (potentially found via Search or Vision).
2.  **Adding a Manual Entry** (Custom Item): The user manually inputs details for an item that is not in the catalog.

There are also "Pre-step" workflows for **Vision Analysis** and **Catalog Lookup**. Vision Analysis now runs the full pipeline and can save items (and queue needs_review), while Catalog Lookup remains a read-only analysis step.

---

## 1. Add Collectable (Catalog Item)

**Endpoint:** `POST /api/shelves/:shelfId/items`  
**Controller Method:** `shelvesController.addCollectable`

This flow is used when linking an existing `collectable` (global catalog item) to a user's shelf.

### Workflow Steps:
1.  **Validation:**
    *   Validates `collectableId` is present in the request body.
    *   Verifies the `shelfId` exists and belongs to the authenticated user (`loadShelfForUser`).
2.  **Catalog Check:**
    *   Queries `collectables` table to ensure the `collectableId` exists (`collectablesQueries.findById`).
3.  **Database Commit:**
    *   Calls `shelvesQueries.addCollectable`.
    *   **Inserts/Updates** into `user_collections`:
        *   Links `user_id`, `shelf_id`, and `collectable_id`.
        *   Sets user-specific fields: `format`, `notes`, `rating`, `position`.
        *   Uses `ON CONFLICT` to update fields if the item is already on the shelf, preventing duplicates.
4.  **Logging:**
    *   Logs a `item.collectable_added` event to the `feed_events` table via `logShelfEvent`.
    *   Payload includes: `title`, `primaryCreator`, `coverUrl`, `type`.
5.  **Response:**
    *   Returns `201 Created` with the newly created item object.

---

## 2. Add Manual Entry (Custom Item)

**Endpoint:** `POST /api/shelves/:shelfId/manual`  
**Controller Method:** `shelvesController.addManualEntry`

This flow is used when the user creates a custom item that doesn't exist in the global catalog.

### Workflow Steps:
1.  **Validation:**
    *   Validates `name` is present in the request body.
    *   Verifies the `shelfId` exists and belongs to the authenticated user.
2.  **Database Commit (Transaction):**
    *   Calls `shelvesQueries.addManual` which executes a transaction.
    *   **Step A:** Inserts into `user_manuals`:
        *   Saves `name`, `type`, `description`, `author`, `publisher`, `format`, `year`, `tags`.
        *   For `other` shelves, also stores `age_statement`, `special_markings`, `label_color`, `regional_item`, `edition`, `barcode`, and `manual_fingerprint`.
        *   This table holds the custom metadata for the item.
    *   **Step B:** Inserts into `user_collections`:
        *   Links `user_id`, `shelf_id` and the new `manual_id`.
        *   The `collectable_id` field remains NULL.
3.  **Logging:**
    *   Logs a `item.manual_added` event to the `feed_events` table.
4.  **Response:**
    *   Returns `201 Created` with the new item object (containing the nested `manual` data).

---

## 3. Vision & Catalog Analysis (Pre-Steps)

These endpoints transform input (Images or Text) into structured data *before* the item is added.

### A. Vision Analysis
**Endpoint:** `POST /api/shelves/:shelfId/vision`  
**Controller Method:** `shelvesController.processShelfVision`

1.  **Input:** Accepts Base64 image data.
2.  **Processing:**
    *   Checks Premium status and Service configuration.
    *   **Vision extraction:** Calls `GoogleGeminiService.detectShelfItemsFromImage()` using the prompt from `visionSettings.json` (supports `{shelfType}` and optional `{shelfDescription}`).
    *   **Pipeline:** `VisionPipelineService` categorizes by confidence and routes through fingerprint -> catalog -> enrichment for non-`other` shelves.
    *   **Other shelves:** Skip catalog/enrichment and save manual-only (low confidence still goes to `needs_review`).
3.  **Output:** Returns `analysis` + `results`, and saves items to the shelf (plus `needs_review` entries when applicable).

### B. Catalog Lookup
**Endpoint:** `POST /api/shelves/:shelfId/catalog-lookup`  
**Controller Method:** `shelvesController.processCatalogLookup`

1.  **Input:** Accepts a list of raw item names/attributes (e.g., from on-device OCR).
2.  **Processing:**
    *   **Enrichment:** Calls `GoogleGeminiService` to clean up and normalize the data.
3.  **Output:** Returns a JSON `analysis` object with enriched item data.
    *   *Note:* This is a read-only analysis step.

---

## Database Relationships

*   **shelves**: The container for items.
*   **collectables**: The global catalog of immutable items/works.
*   **user_manuals**: User-created custom item metadata.
*   **user_collections**: The join table linking a User + Shelf + (Collectable OR Manual). This is the content of the shelf.
*   **feed_events**: Audit log of actions (added, removed, etc.).
